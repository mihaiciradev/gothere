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
