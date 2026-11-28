import { createHash } from "node:crypto";
import { z } from "zod";
import { serverEnv } from "@/infrastructure/env";
import { externalAgentStatus } from "@/infrastructure/external-agent";
import {
  buildDiagnosticReport,
  generateInvestigationPackage,
  getInvestigationPackage,
  loadIncident,
  recordDispatchOutcome,
} from "@/modules/incidents";
import { AppError } from "@/shared/errors";
import type { ActionDefinition, ExecutionContext } from "./types";

/**
 * Platform-scope engineering actions (Control Center). Authority is the platform-admin role, re-read from the database;
 * an AI agent acts with the invoking admin's rights and never more. Severity never changes any of these policies.
 */

const define = <I, P, O>(definition: ActionDefinition<I, P, O>) => definition;

export const environment = () => ({ appEnv: serverEnv().APP_ENV, commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null });

const attributionOf = (ctx: ExecutionContext) => ({ actorType: ctx.audit.actorType, actorUserId: ctx.actor?.userId ?? null });

const incidentInput = z.object({ incidentId: z.uuid() }).strict();

export const incidentReadReport = define({
  id: "incident.read_report",
  title: "Read a sanitized incident report",
  description: "Returns the sanitized diagnostic report of an incident: impact, evidence with ids, where to look, runbook. Read-only.",
  input: incidentInput,
  params: incidentInput,
  risk: "LOW",
  scope: "platform",
  approval: "none",
  limits: { perMinute: 30 },
  idempotency: "Read-only.",
  async execute(ctx, p) {
    return buildDiagnosticReport(await loadIncident(ctx.db, p.incidentId), environment());
  },
});

export const incidentGeneratePackage = define({
  id: "incident.generate_investigation_package",
  title: "Generate an investigation package",
  description:
    "Creates a sanitized investigation package (report + constraints) for an external coding agent. Writes a document only: nothing is run, nothing is sent anywhere.",
  input: incidentInput,
  params: incidentInput,
  risk: "MEDIUM",
  scope: "platform",
  approval: "none",
  limits: { perMinute: 5 },
  idempotency: "Natural: a package generated in the last hour is returned instead of a new one.",
  async execute(ctx, p) {
    return generateInvestigationPackage(ctx.db, p.incidentId, environment(), attributionOf(ctx));
  },
});

const dispatchInput = z.object({ packageId: z.uuid() }).strict();
const dispatchParams = z.object({ packageId: z.uuid(), incidentId: z.uuid(), reportSha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
type DispatchParams = z.infer<typeof dispatchParams>;

const reportHash = (report: unknown) => createHash("sha256").update(JSON.stringify(report)).digest("hex");

export const incidentDispatchInvestigation = define({
  id: "incident.dispatch_investigation",
  title: "Dispatch an external investigation",
  description:
    "Asks an external coding agent to investigate on an isolated branch and open a pull request for human review. Spends external credits, so it always needs a human approval, whoever asks and whatever the severity.",
  input: dispatchInput,
  params: dispatchParams,
  risk: "HIGH",
  scope: "platform",
  approval: "always",
  limits: { perMinute: 2 },
  idempotency: "One open request per package content; execution happens at most once (approval semantics).",
  async bind(ctx, input) {
    const pkg = await getInvestigationPackage(ctx.db, input.packageId);
    return { packageId: pkg.id, incidentId: pkg.incidentId, reportSha256: reportHash(pkg.report) };
  },
  async preconditions(ctx, p: DispatchParams) {
    const pkg = await getInvestigationPackage(ctx.db, p.packageId);
    if (reportHash(pkg.report) !== p.reportSha256) throw new AppError("PRECONDITION_FAILED", "The package changed after this request was made.");
    if (pkg.status !== "generated" && pkg.status !== "dispatch_requested") throw new AppError("PRECONDITION_FAILED", `This package is already ${pkg.status}.`);
  },
  async execute(ctx, p: DispatchParams) {
    const agent = externalAgentStatus();
    // Not connected: the approved request fails with this reason (stored on the request); the package stays generated.
    if (!agent.configured) throw new AppError("PRECONDITION_FAILED", agent.reason);
    // A real adapter would start the external run here and return its id. None is connected in this build.
    await recordDispatchOutcome(ctx.db, p.packageId, { status: "failed", executor: agent.executor });
    throw new AppError("PRECONDITION_FAILED", "The external agent adapter is not implemented.");
  },
  describe: (p: DispatchParams) => `Dispatch the investigation package ${p.packageId.slice(0, 8)} to an external coding agent.`,
});
