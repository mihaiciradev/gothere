import { runMigrations } from "../src/infrastructure/db/migrate";
import { assertNonProduction, loadLocalEnv } from "./lib/env";

loadLocalEnv();
assertNonProduction("Migration");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required.");

await runMigrations(url);
console.log(JSON.stringify({ level: "info", msg: "migrations applied", host: new URL(url).host }));
