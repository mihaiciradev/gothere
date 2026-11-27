import { existsSync } from "node:fs";

export function loadLocalEnv(): void {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
}

/** Destructive or data-writing scripts refuse to touch production unless explicitly overridden. */
export function assertNonProduction(task: string): void {
  if (process.env.APP_ENV === "production" && process.env.ALLOW_PRODUCTION_SCRIPTS !== "true") {
    throw new Error(`${task} refused: APP_ENV=production. Set ALLOW_PRODUCTION_SCRIPTS=true only with explicit approval.`);
  }
}
