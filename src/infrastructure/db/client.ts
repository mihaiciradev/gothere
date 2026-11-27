import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { serverEnv } from "../env";
import * as schema from "./schema";

function createDatabase(connectionString: string, max: number) {
  const pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
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
