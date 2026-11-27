import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { serverEnv } from "../env";
import * as schema from "./schema";

/**
 * Neon's pooler (PgBouncer, transaction mode) is addressed by an endpoint id ending in `-pooler`. Startup parameters
 * it does not track may be rejected there, so on pooled connections the statement timeout comes from the role
 * (`ALTER ROLE … SET statement_timeout`, scripts/sql/database-roles.sql) instead of the client.
 */
export function isPooledConnection(connectionString: string): boolean {
  return /-pooler\./.test(new URL(connectionString).hostname);
}

function createDatabase(connectionString: string, max: number) {
  const pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    ...(isPooledConnection(connectionString) ? {} : { statement_timeout: 10_000 }),
    // node-postgres ignores `channel_binding` in the URL; honour Neon's `channel_binding=require` explicitly.
    enableChannelBinding: new URL(connectionString).searchParams.get("channel_binding") === "require",
    application_name: "gothere",
  });
  return { pool, db: drizzle(pool, { schema }) };
}

export type Database = ReturnType<typeof createDatabase>["db"];
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Either the root connection or an open transaction; services accept both. */
export type DbExecutor = Database | Transaction;

const globalForDb = globalThis as unknown as { gothereDb?: ReturnType<typeof createDatabase> };

/** Lazily created so builds and unit tests never open connections. Reused across hot reloads. */
export function getDb(): Database {
  if (!globalForDb.gothereDb) {
    const env = serverEnv();
    globalForDb.gothereDb = createDatabase(env.DATABASE_URL, env.DATABASE_POOL_MAX);
  }
  return globalForDb.gothereDb.db;
}

export async function closeDb(): Promise<void> {
  const current = globalForDb.gothereDb;
  globalForDb.gothereDb = undefined;
  await current?.pool.end();
}

export { createDatabase };
