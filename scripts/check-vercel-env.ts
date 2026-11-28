import { existsSync, readFileSync, rmSync } from "node:fs";
import { parseEnv } from "node:util";
import { parseServerEnv } from "../src/infrastructure/env";

/**
 * Validates Vercel's production variables without printing any value. Pull them first (git-ignored file):
 *   pnpm dlx vercel@latest env pull .env.vercel.production --environment=production --yes
 *   pnpm vercel:check-env .env.vercel.production --domain=https://gothere.mihaic.me
 * Compares against .env.neon (same database user/password, same auth secret) and .env.local (no reused local
 * secrets), then deletes the pulled file. Values marked "Sensitive" in Vercel are not pullable and are reported so.
 */
const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
const domain = process.argv.find((a) => a.startsWith("--domain="))?.slice("--domain=".length) ?? "https://gothere.mihaic.me";
const keep = process.argv.includes("--keep");
if (!file || !existsSync(file)) throw new Error("Pass the pulled env file, e.g. pnpm vercel:check-env .env.vercel.production");

const read = (path: string) => (existsSync(path) ? (parseEnv(readFileSync(path, "utf8")) as Record<string, string | undefined>) : {});
// Sensitive variables are pulled as a "[SENSITIVE]" placeholder: present, but unreadable.
const vercel = Object.fromEntries(Object.entries(read(file)).map(([k, v]) => [k, v === "[SENSITIVE]" ? "" : v]));
const neon = read(".env.neon");
const local = read(".env.local");

type Result = { check: string; ok: boolean | null; note?: string };
const results: Result[] = [];
const check = (name: string, ok: boolean | null, note?: string) => results.push({ check: name, ok, note });
const has = (k: string) => !!vercel[k];
const unreadable = (k: string) => k in vercel && !vercel[k];

for (const k of ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "PAYMENT_WEBHOOK_SECRET", "CRON_SECRET", "APP_ENV"]) {
  check(`${k} is set`, has(k) ? true : unreadable(k) ? null : false, unreadable(k) ? "present but not readable (Sensitive): confirm in the dashboard" : undefined);
}
try {
  // Unreadable values are replaced by well-formed stand-ins so the rest of the schema can still be checked.
  const standIn = (k: string) => (k.endsWith("_URL") ? "postgres://u:p@db.invalid/db" : "x".repeat(32));
  parseServerEnv({ ...vercel, ...Object.fromEntries(Object.keys(vercel).filter(unreadable).map((k) => [k, standIn(k)])) });
  check("passes the app's env schema", true);
} catch (error) {
  check("passes the app's env schema", false, (error as Error).message.split("\n").slice(1).join("; "));
}
check(
  "SITE_ACCESS_PASSWORD is set (access gate on; without it the site stays closed)",
  vercel.SITE_ACCESS === "open" ? null : has("SITE_ACCESS_PASSWORD") ? (vercel.SITE_ACCESS_PASSWORD!.length >= 12) : unreadable("SITE_ACCESS_PASSWORD") ? null : false,
  vercel.SITE_ACCESS === "open" ? "SITE_ACCESS=open: gate disabled" : unreadable("SITE_ACCESS_PASSWORD") ? "present but not readable (Sensitive)" : undefined,
);
check("APP_ENV is preview (fictional demo data)", vercel.APP_ENV === "preview", vercel.APP_ENV);
check(`BETTER_AUTH_URL is ${domain}`, vercel.BETTER_AUTH_URL === domain);

if (has("DATABASE_URL")) {
  const u = new URL(vercel.DATABASE_URL!);
  check("DATABASE_URL uses the restricted role gothere_app", u.username === "gothere_app", u.username);
  check("DATABASE_URL is the pooled host", /-pooler\./.test(u.hostname));
  check("DATABASE_URL uses sslmode=verify-full", u.searchParams.get("sslmode") === "verify-full", u.searchParams.get("sslmode") ?? "missing");
  check("DATABASE_URL requires channel binding", u.searchParams.get("channel_binding") === "require");
  if (neon.RUNTIME_DATABASE_URL) {
    const n = new URL(neon.RUNTIME_DATABASE_URL);
    check("DATABASE_URL matches .env.neon RUNTIME_DATABASE_URL (host, db, password)", u.hostname === n.hostname && u.pathname === n.pathname && u.password === n.password);
  }
}
if (has("BETTER_AUTH_SECRET") && neon.BETTER_AUTH_SECRET) check("BETTER_AUTH_SECRET equals the one used for seeding", vercel.BETTER_AUTH_SECRET === neon.BETTER_AUTH_SECRET);
for (const k of ["BETTER_AUTH_SECRET", "PAYMENT_WEBHOOK_SECRET", "CRON_SECRET"]) {
  if (has(k) && local[k]) check(`${k} is not reused from .env.local`, vercel[k] !== local[k]);
}

const aiOn = has("ANTHROPIC_API_KEY") || unreadable("ANTHROPIC_API_KEY");
if (aiOn) {
  check("AI_MODEL_FAST is set and not Opus", !!vercel.AI_MODEL_FAST && !vercel.AI_MODEL_FAST.includes("opus"), vercel.AI_MODEL_FAST);
  const budget = Number(vercel.AI_MONTHLY_BUDGET_MINOR ?? 0);
  check("AI_MONTHLY_BUDGET_MINOR ≤ 20 (US$0.20 / month)", budget > 0 && budget <= 20, String(vercel.AI_MONTHLY_BUDGET_MINOR ?? "missing"));
} else {
  check("AI configured", null, "ANTHROPIC_API_KEY absent: runtime AI is off (deterministic fallbacks)");
}
check("PAYMENT_SIMULATOR_SCENARIOS", null, vercel.PAYMENT_SIMULATOR_SCENARIOS || "unset (disabled outside local/test)");

for (const k of ["MIGRATION_DATABASE_URL", "RUNTIME_DATABASE_URL", "DATABASE_APP_ROLE", "TEST_DATABASE_URL", "SEED_DEMO_PASSWORD", "SEED_ADMIN_PASSWORD", "SEED_ALLOW_ADMIN", "ALLOW_PRODUCTION_SCRIPTS"]) {
  check(`${k} is NOT on Vercel`, !(k in vercel));
}

if (!keep) rmSync(file);
for (const r of results) console.log(`${r.ok === true ? "PASS" : r.ok === false ? "FAIL" : "INFO"}  ${r.check}${r.note ? `  (${r.note})` : ""}`);
console.log(keep ? `Kept ${file}; delete it when done.` : `Deleted ${file}.`);
if (results.some((r) => r.ok === false)) process.exit(1);
