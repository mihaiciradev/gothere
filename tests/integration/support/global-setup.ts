import { Client } from "pg";
import { runMigrations } from "../../../src/infrastructure/db/migrate";
import { assertSafeTestDatabase } from "./test-database";

export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://gothere:gothere_local@127.0.0.1:54329/gothere_test";
  assertSafeTestDatabase(url);

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  } finally {
    await client.end();
  }
  await runMigrations(url);
}
