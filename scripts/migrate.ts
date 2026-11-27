import { applyRuntimeGrants, runMigrations } from "../src/infrastructure/db/migrate";
import { assertNonProduction, assertTarget, loadScriptEnv } from "./lib/env";

/**
 * Applies pending migrations. Uses MIGRATION_DATABASE_URL (the schema-owning role, direct connection) when set,
 * otherwise DATABASE_URL. With DATABASE_APP_ROLE set, re-applies the runtime role's grants afterwards.
 *   local:  pnpm db:migrate
 *   remote: pnpm db:migrate --env-file=.env.neon
 */
const env = loadScriptEnv();
assertNonProduction("Migration");

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required.");
const target = assertTarget("Migration", url, env);

await runMigrations(url);
const appRole = process.env.DATABASE_APP_ROLE;
if (appRole) await applyRuntimeGrants(url, appRole);
console.log(JSON.stringify({ level: "info", msg: "migrations applied", target, envFile: env.file, runtimeGrants: appRole ?? "skipped" }));
