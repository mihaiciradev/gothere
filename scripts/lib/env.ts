import { existsSync } from "node:fs";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** `--env-file=<path>` from the command line, e.g. `pnpm db:migrate --env-file=.env.neon`. */
function envFileArgument(): string | undefined {
  const arg = process.argv.find((a) => a.startsWith("--env-file="));
  return arg?.slice("--env-file=".length);
}

/**
 * Loads exactly one env file into the script's environment: the one named by `--env-file=`, or `.env.local`.
 * Never both, so a remote run can't silently pick up a local value it forgot to set.
 * Variables already set in the shell still win (Node's loadEnvFile does not override).
 */
export function loadScriptEnv(): { file: string | null; explicit: boolean } {
  const requested = envFileArgument();
  if (requested) {
    if (!existsSync(requested)) throw new Error(`Env file not found: ${requested}`);
    process.loadEnvFile(requested);
    return { file: requested, explicit: true };
  }
  if (existsSync(".env.local")) {
    process.loadEnvFile(".env.local");
    return { file: ".env.local", explicit: false };
  }
  return { file: null, explicit: false };
}

/** Destructive or data-writing scripts refuse to touch production unless explicitly overridden. */
export function assertNonProduction(task: string): void {
  if (process.env.APP_ENV === "production" && process.env.ALLOW_PRODUCTION_SCRIPTS !== "true") {
    throw new Error(`${task} refused: APP_ENV=production. Set ALLOW_PRODUCTION_SCRIPTS=true only with explicit approval.`);
  }
}

/**
 * A database outside this machine is only touched when its URL came from an explicitly named env file, never from a
 * stray shell variable or `.env.local`. Returns a printable target (host, database, role; never the password).
 */
export function assertTarget(task: string, connectionString: string, env: { explicit: boolean }): string {
  const url = new URL(connectionString);
  const target = `${url.username}@${url.hostname}${url.pathname}`;
  if (!LOCAL_HOSTS.has(url.hostname) && !env.explicit) {
    throw new Error(`${task} refused: ${url.hostname} is not local. Name the env file explicitly: --env-file=<file>.`);
  }
  return target;
}
