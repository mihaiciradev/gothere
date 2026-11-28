import { and, eq, gte, sql } from "drizzle-orm";
import { askConcierge, createAiGateway, createAnthropicProvider, delegateRecommendation, runEngineeringAgent, writeNarratives } from "../src/ai";
import { createSimulatedIncident } from "../src/modules/incidents";
import { createDatabase } from "../src/infrastructure/db/client";
import { actionRequests, aiUsageRecords, commercialRecommendations, experiences, organizations, users } from "../src/infrastructure/db/schema";
import { parseServerEnv } from "../src/infrastructure/env";
import { analyzeDemand } from "../src/modules/analytics";
import { aiSpendThisMonth } from "../src/modules/operations";
import { assertNonProduction, assertTarget, loadScriptEnv } from "./lib/env";

/**
 * Opt-in live check of real model inference (spends money). Runs one concierge question, the organiser agent on the
 * seeded Sunset Sessions recommendation, and one AI brief, against a LOCAL seeded database. The spend is capped by the
 * gateway's own atomic reservations: budget = this database's month-to-date spend + --max-usd.
 *   DATABASE_URL=<local seeded db> pnpm ai:verify-live --max-usd=0.02
 */
const arg = process.argv.find((a) => a.startsWith("--max-usd="));
const maxUsd = arg ? Number(arg.slice("--max-usd=".length)) : NaN;
if (!(maxUsd > 0 && maxUsd <= 0.05)) throw new Error("Pass an explicit spending cap, e.g. --max-usd=0.02 (at most 0.05).");

const scriptEnv = loadScriptEnv();
assertNonProduction("Live AI verification");
const env = parseServerEnv(process.env);
const target = assertTarget("Live AI verification", env.DATABASE_URL, scriptEnv);
if (!/^(localhost|127\.0\.0\.1)$/.test(new URL(env.DATABASE_URL).hostname)) throw new Error("Run live verification against a local database only.");
if (!env.ANTHROPIC_API_KEY || !env.AI_MODEL_FAST) throw new Error("ANTHROPIC_API_KEY and AI_MODEL_FAST are required.");
const pricing =
  env.AI_INPUT_MICRO_USD_PER_MTOK && env.AI_OUTPUT_MICRO_USD_PER_MTOK
    ? { inputMicroUsdPerMTok: env.AI_INPUT_MICRO_USD_PER_MTOK, outputMicroUsdPerMTok: env.AI_OUTPUT_MICRO_USD_PER_MTOK }
    : env.AI_MODEL_FAST === "claude-haiku-5-5"
      ? { inputMicroUsdPerMTok: 100_000, outputMicroUsdPerMTok: 500_000 }
      : null;
if (!pricing) throw new Error("No price known for this model; set AI_INPUT/OUTPUT_MICRO_USD_PER_MTOK.");

const { db, pool } = createDatabase(env.DATABASE_URL, 4);
const started = new Date();
try {
  const capMicroUsd = Math.round(maxUsd * 1_000_000);
  const spentBefore = await aiSpendThisMonth(db);
  const gateway = createAiGateway({
    provider: createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.AI_MODEL_FAST, timeoutMs: env.AI_TIMEOUT_MS }),
    pricing,
    monthlyBudgetMicroUsd: spentBefore + capMicroUsd,
    runTimeoutMs: env.AI_TIMEOUT_MS * 2,
  });
  console.log(JSON.stringify({ target, model: env.AI_MODEL_FAST, capMicroUsd, ledgerBefore: spentBefore }));

  const only = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
  if (!only || only === "commerce") {
  // 1. Concierge, as a signed-in seeded attendee (anonymous visitors never get AI).
  const [attendee] = await db.select().from(users).where(eq(users.email, "maya@attendee.gothere.test"));
  if (!attendee) throw new Error("Seed the database first (pnpm db:seed).");
  const concierge = await askConcierge(
    { db, gateway, subjectSecret: env.BETTER_AUTH_SECRET },
    { message: "Something by the sea in July, ideally with a sunset, under 100 euros" },
    { actor: { kind: "user", userId: attendee.id, email: attendee.email, platformRole: "attendee" }, subject: { userId: attendee.id } },
  );
  console.log(JSON.stringify({ step: "concierge", mode: concierge.mode, notice: concierge.notice, reply: concierge.reply, picks: concierge.picks.map((p) => ({ event: p.event.slug, experience: p.experience?.slug ?? null, fromPriceMinor: p.event.fromPriceMinor, why: p.why })) }));

  // 2. Organiser agent on the seeded flagship scenario (Tidal Assembly owner).
  const [owner] = await db.select().from(users).where(eq(users.email, "irina@tidal.gothere.test"));
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, "tidal-assembly"));
  if (!owner || !org) throw new Error("Seed the database first (pnpm db:seed).");
  const actor = { kind: "user" as const, userId: owner.id, email: owner.email, platformRole: "attendee" as const };
  const analysis = await analyzeDemand(db, actor, org.id);
  let rec = analysis.recommendations.find((r) => r.status === "open");
  if (!rec) {
    console.log(JSON.stringify({ step: "organizer_agent", skipped: "no open recommendation (already drafted in this database)" }));
  } else {
    const narrative = await writeNarratives({ db, gateway }, actor, org.id);
    const [afterBrief] = await db.select().from(commercialRecommendations).where(eq(commercialRecommendations.id, rec.id));
    console.log(JSON.stringify({ step: "brief", ...narrative, source: afterBrief!.narrativeSource, brief: afterBrief!.narrative }));

    const delegation = await delegateRecommendation({ db, gateway }, actor, org.id, rec.id);
    const [draft] = delegation.experienceId ? await db.select().from(experiences).where(eq(experiences.id, delegation.experienceId)) : [];
    const [request] = delegation.approvalRequestId ? await db.select().from(actionRequests).where(eq(actionRequests.id, delegation.approvalRequestId)) : [];
    console.log(JSON.stringify({ step: "organizer_agent", mode: delegation.mode, notice: delegation.notice, summary: delegation.summary, draft: draft ? { status: draft.status, origin: draft.origin, title: draft.title } : null, approval: request ? { status: request.status, initiator: request.initiator, risk: request.risk } : null }));
    rec = undefined;
  }
  }

  // 3. Engineering agent on a simulated incident (records only), as the seeded platform admin (local/test seed).
  if (!only || only === "incident") {
    const [ops] = await db.select().from(users).where(eq(users.email, "ops@control.gothere.test"));
    if (!ops) throw new Error("No platform admin in this database (seeded only for local/test).");
    const admin = { kind: "user" as const, userId: ops.id, email: ops.email, platformRole: "platform_admin" as const };
    const { incidentId } = await createSimulatedIncident(db, admin, { scenario: "checkout-errors" }, { allowed: true });
    const agent = await runEngineeringAgent({ db, gateway }, admin, incidentId);
    const body = agent.analysis.body as { summary?: string; likelyCauses?: { cause: string; evidence: string[] }[]; confidence?: string };
    console.log(JSON.stringify({ step: "engineering_agent", mode: agent.mode, source: agent.analysis.source, notice: agent.notice, summary: body.summary, causes: body.likelyCauses, confidence: body.confidence, packageGenerated: !!agent.packageId, dispatchRequested: !!agent.dispatchRequestId }));
  }

  const rows = await db
    .select({
      feature: aiUsageRecords.feature,
      status: aiUsageRecords.status,
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`sum(${aiUsageRecords.inputTokens})::int`,
      outputTokens: sql<number>`sum(${aiUsageRecords.outputTokens})::int`,
      costMicroUsd: sql<number>`sum(${aiUsageRecords.costMicroUsd})::int`,
    })
    .from(aiUsageRecords)
    .where(and(gte(aiUsageRecords.createdAt, started), eq(aiUsageRecords.model, env.AI_MODEL_FAST)))
    .groupBy(aiUsageRecords.feature, aiUsageRecords.status);
  const total = rows.reduce((s, r) => s + r.costMicroUsd, 0);
  console.log(JSON.stringify({ step: "ledger", rows, totalMicroUsd: total, totalUsd: total / 1_000_000, withinCap: total <= capMicroUsd }));
} finally {
  await pool.end();
}
