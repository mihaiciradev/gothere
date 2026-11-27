import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "./client";

export async function runMigrations(connectionString: string): Promise<void> {
  const { db, pool } = createDatabase(connectionString, 1);
  try {
    await migrate(db, { migrationsFolder: "drizzle" });
  } finally {
    await pool.end();
  }
}

/**
 * Least-privilege grants for the runtime role, re-applied after every migration by the migrating role (the owner of
 * every table), so new tables are covered and nothing is forgotten. Idempotent. Data access only: no DDL, no
 * TRUNCATE, and the append-only and approval tables cannot be rewritten or deleted (triggers enforce the same).
 */
export async function applyRuntimeGrants(connectionString: string, appRole: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(appRole)) throw new Error("DATABASE_APP_ROLE must be a plain lowercase role name.");
  const { db, pool } = createDatabase(connectionString, 1);
  const role = sql.identifier(appRole);
  try {
    const exists = await db.execute(sql`SELECT 1 FROM pg_roles WHERE rolname = ${appRole}`);
    if (exists.rows.length === 0) throw new Error(`Role ${appRole} does not exist; create it first (scripts/sql/database-roles.sql).`);
    await db.transaction(async (tx) => {
      await tx.execute(sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
      await tx.execute(sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
      await tx.execute(sql`REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM ${role}`);
      await tx.execute(sql`REVOKE UPDATE, DELETE ON audit_records FROM ${role}`);
      await tx.execute(sql`REVOKE DELETE ON action_requests FROM ${role}`);
    });
  } finally {
    await pool.end();
  }
}
