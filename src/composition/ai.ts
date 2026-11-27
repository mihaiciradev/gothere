import { type AiGateway, type AiPricing, createAiGateway, createAnthropicProvider } from "@/ai";
import { type ServerEnv, serverEnv } from "@/infrastructure/env";

/** List prices (micro-USD per million tokens, prompts ≤ 100K tokens). Unknown models need explicit prices in env. */
const builtInPricing: Record<string, AiPricing> = {
  "claude-haiku-5-5": { inputMicroUsdPerMTok: 100_000, outputMicroUsdPerMTok: 500_000 },
  "claude-haiku-4-5": { inputMicroUsdPerMTok: 1_000_000, outputMicroUsdPerMTok: 5_000_000 },
};

export type AiStatus = { enabled: boolean; model: string | null; monthlyBudgetMinor: number; reason: string | null };

function resolve(env: ServerEnv): { status: AiStatus; pricing: AiPricing | null } {
  const budget = env.AI_MONTHLY_BUDGET_MINOR ?? 0;
  const model = env.AI_MODEL_FAST ?? null;
  const pricing =
    env.AI_INPUT_MICRO_USD_PER_MTOK && env.AI_OUTPUT_MICRO_USD_PER_MTOK
      ? { inputMicroUsdPerMTok: env.AI_INPUT_MICRO_USD_PER_MTOK, outputMicroUsdPerMTok: env.AI_OUTPUT_MICRO_USD_PER_MTOK }
      : model
        ? (builtInPricing[model] ?? null)
        : null;
  const reason = !env.ANTHROPIC_API_KEY
    ? "ANTHROPIC_API_KEY is not set"
    : !model
      ? "AI_MODEL_FAST is not set"
      : budget <= 0
        ? "AI_MONTHLY_BUDGET_MINOR is not set"
        : !pricing
          ? "no price is known for this model; set AI_INPUT_MICRO_USD_PER_MTOK and AI_OUTPUT_MICRO_USD_PER_MTOK"
          : null;
  return { status: { enabled: reason === null, model, monthlyBudgetMinor: budget, reason }, pricing };
}

let cached: AiGateway | undefined;

/** The runtime AI Gateway. Without full configuration it is a gateway with no provider: every feature falls back. */
export function aiGateway(): AiGateway {
  if (cached) return cached;
  const env = serverEnv();
  const { status, pricing } = resolve(env);
  cached = createAiGateway({
    provider: status.enabled ? createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY!, model: status.model!, timeoutMs: env.AI_TIMEOUT_MS }) : null,
    pricing: pricing ?? { inputMicroUsdPerMTok: 0, outputMicroUsdPerMTok: 0 },
    // Budget is US cents; the ledger is micro-USD.
    monthlyBudgetMicroUsd: status.enabled ? status.monthlyBudgetMinor * 10_000 : 0,
    runTimeoutMs: env.AI_TIMEOUT_MS * 2,
  });
  return cached;
}

export function aiStatus(): AiStatus {
  return resolve(serverEnv()).status;
}

/** Key for pseudonymous demand-signal subjects. Derived (domain-separated) from the session secret. */
export function demandSubjectSecret(): string {
  return serverEnv().BETTER_AUTH_SECRET;
}
