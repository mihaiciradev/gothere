import { z } from "zod";

const secret = z.string().min(32, "must be at least 32 characters");
/** Treats an empty value (`KEY=` in an env file) as unset. */
const unsetIfEmpty = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema);

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["local", "test", "preview", "production"]).default("local"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  DATABASE_URL: z.url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),

  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: z.url(),

  /** Bearer secret for the job runner; Vercel Cron sends it automatically when set as CRON_SECRET. */
  CRON_SECRET: unsetIfEmpty(secret.optional()),
  /** HMAC key for payment provider (simulator) notifications. */
  PAYMENT_WEBHOOK_SECRET: secret,
  /** Non-default payment simulator scenarios are a demonstration control; off unless explicitly enabled. */
  PAYMENT_SIMULATOR_SCENARIOS: unsetIfEmpty(z.enum(["enabled", "disabled"]).optional()),

  /** Temporary pre-release access gate (src/proxy.ts). Deployed environments fail closed without a password. */
  SITE_ACCESS_PASSWORD: unsetIfEmpty(z.string().min(12, "must be at least 12 characters").optional()),
  /** "open" disables the gate explicitly (only once the site may be public). */
  SITE_ACCESS: unsetIfEmpty(z.enum(["open"]).optional()),

  /** Runtime AI. All optional: without a key, model and budget the app runs with deterministic fallbacks. */
  ANTHROPIC_API_KEY: unsetIfEmpty(z.string().min(1).optional()),
  /** Fast, low-cost model for routine inference (a Haiku-class id). Opus is rejected for runtime use. */
  AI_MODEL_FAST: unsetIfEmpty(
    z
      .string()
      .regex(/^[a-z0-9.-]+$/, "must be a model id")
      .refine((id) => !id.includes("opus"), "Opus models are not allowed for routine runtime inference")
      .optional(),
  ),
  /** Monthly ceiling in US cents. 0 or unset disables AI calls. */
  AI_MONTHLY_BUDGET_MINOR: unsetIfEmpty(z.coerce.number().int().min(0).max(1_000_000).optional()),
  /** Prices in micro-USD per million tokens; required for model ids without a built-in price. */
  AI_INPUT_MICRO_USD_PER_MTOK: unsetIfEmpty(z.coerce.number().int().min(1).optional()),
  AI_OUTPUT_MICRO_USD_PER_MTOK: unsetIfEmpty(z.coerce.number().int().min(1).optional()),
  AI_TIMEOUT_MS: unsetIfEmpty(z.coerce.number().int().min(1000).max(60_000).default(12_000)),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid server environment:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "EnvValidationError";
  }
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  const env = result.data;
  if (env.APP_ENV === "production" && !env.BETTER_AUTH_URL.startsWith("https://")) {
    throw new EnvValidationError(["BETTER_AUTH_URL: must use https in production"]);
  }
  return env;
}

/** Scenarios default to enabled only for local development and tests. */
export function simulatorScenariosEnabled(env: ServerEnv): boolean {
  return (env.PAYMENT_SIMULATOR_SCENARIOS ?? (env.APP_ENV === "local" || env.APP_ENV === "test" ? "enabled" : "disabled")) === "enabled";
}

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
