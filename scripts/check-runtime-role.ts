import type { Pool } from "pg";
import { createDatabase, isPooledConnection } from "../src/infrastructure/db/client";
import { assertTarget, loadScriptEnv } from "./lib/env";

/**
 * Proves the runtime role is least-privilege and that the app's connection settings work, without changing data.
 * Checks DATABASE_URL and, if set, RUNTIME_DATABASE_URL (the pooled URL Vercel will use).
 *   pnpm db:check-role --env-file=.env.neon
 */
const env = loadScriptEnv();
const urls = [process.env.DATABASE_URL, process.env.RUNTIME_DATABASE_URL].filter((u): u is string => !!u);
if (urls.length === 0) throw new Error("DATABASE_URL is required.");

type Check = { check: string; ok: boolean; detail?: string };

async function expectDenied(pool: Pool, statement: string): Promise<Check> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(statement);
    return { check: `denied: ${statement}`, ok: false, detail: "statement was allowed" };
  } catch (error) {
    const code = (error as { code?: string }).code;
    return { check: `denied: ${statement}`, ok: code === "42501", detail: code === "42501" ? undefined : `unexpected error ${code}` };
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

let failed = false;
for (const url of urls) {
  const target = assertTarget("Role check", url, env);
  const { pool } = createDatabase(url, 2);
  const checks: Check[] = [];
  try {
    const who = await pool.query<{ user: string; superuser: string; timeout: string }>(
      "SELECT current_user AS user, current_setting('is_superuser') AS superuser, current_setting('statement_timeout') AS timeout",
    );
    const { user, superuser, timeout } = who.rows[0]!;
    checks.push({ check: "connected as a non-superuser", ok: superuser === "off", detail: `${user}, is_superuser=${superuser}` });
    checks.push({ check: "statement timeout is set", ok: timeout !== "0", detail: timeout });
    const migrated = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations").catch(() => null);
    checks.push({ check: "cannot read the migration journal", ok: migrated === null });
    const events = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM events");
    checks.push({ check: "reads application data", ok: true, detail: `${events.rows[0]!.n} events` });
    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");
      await tx.query("SELECT pg_advisory_xact_lock(1, 1)");
      await tx.query("UPDATE api_rate_limits SET count = count WHERE false");
      checks.push({ check: "writes data and takes transaction locks", ok: true });
    } finally {
      await tx.query("ROLLBACK");
      tx.release();
    }
    checks.push(await expectDenied(pool, "CREATE TABLE gothere_privilege_probe (id int)"));
    checks.push(await expectDenied(pool, "UPDATE audit_records SET action = action WHERE false"));
    checks.push(await expectDenied(pool, "DELETE FROM audit_records WHERE false"));
    checks.push(await expectDenied(pool, "DELETE FROM action_requests WHERE false"));
    checks.push(await expectDenied(pool, "TRUNCATE api_rate_limits"));
  } finally {
    await pool.end();
  }
  for (const c of checks) if (!c.ok) failed = true;
  console.log(JSON.stringify({ target, pooled: isPooledConnection(url), checks }, null, 2));
}
if (failed) {
  console.error("Role check FAILED: see the checks with ok=false above.");
  process.exit(1);
}
console.log("Role check passed.");
