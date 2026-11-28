import { z } from "zod";
import type { DbExecutor } from "@/infrastructure/db/client";
import { logger } from "@/infrastructure/logging/logger";
import { currentCorrelationId } from "@/infrastructure/request-context";
import { recordAiUsage, reserveAiBudget, settleAiUsage } from "@/modules/operations";
import { type AiMessage, type AiPricing, type AiProvider, AiProviderError, type AiToolSpec } from "./types";

export type AiGatewayConfig = {
  provider: AiProvider | null;
  pricing: AiPricing;
  /** Hard monthly ceiling in micro-USD; calls stop once spend reaches it. */
  monthlyBudgetMicroUsd: number;
  /** Wall-clock limit for a whole agent run, including tool execution. */
  runTimeoutMs: number;
};

export type ToolResult = { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } };

export type AgentTool = AiToolSpec & { run: (input: unknown) => Promise<ToolResult> };

export type FinalAnswer<T> = { name: string; description: string; schema: z.ZodType<T> };

export type AgentRunRequest<T> = {
  feature: string;
  system: string;
  prompt: string;
  tools: AgentTool[];
  final: FinalAnswer<T>;
  maxSteps?: number;
  maxToolCalls?: number;
  maxOutputTokens?: number;
  attribution?: { organizationId?: string | null; userId?: string | null };
};

export type AgentFailure = "unavailable" | "budget_exceeded" | "timeout" | "failed" | "refused" | "invalid_output" | "step_limit";

export type AgentRun<T> =
  | { status: "completed"; result: T; model: string; toolCalls: { name: string; ok: boolean }[] }
  | { status: AgentFailure; model: string | null; toolCalls: { name: string; ok: boolean }[] };

export type AiGateway = {
  readonly available: boolean;
  readonly model: string | null;
  runAgent<T>(db: DbExecutor, request: AgentRunRequest<T>): Promise<AgentRun<T>>;
};

/** JSON Schema for a tool input (draft keyword removed; providers expect a bare object schema). */
export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/** Ceil, so the ledger never under-reports spend. */
export function costMicroUsd(pricing: AiPricing, usage: { inputTokens: number; outputTokens: number }): number {
  return Math.ceil((usage.inputTokens * pricing.inputMicroUsdPerMTok + usage.outputTokens * pricing.outputMicroUsdPerMTok) / 1_000_000);
}

/** Fixed allowance for provider-side prompt framing (tool-use preamble, role markers) not present in our JSON. */
const PROMPT_OVERHEAD_TOKENS = 2_048;

/**
 * Upper bound on one call's cost, known before the call. Every token encodes at least one byte, so the UTF-8 size of
 * everything we send (plus a framing allowance) bounds the input tokens; output, reasoning included, is capped by
 * `max_tokens`. Reserving this bound is what makes the monthly budget a hard ceiling.
 */
export function maxCallCostMicroUsd(
  pricing: AiPricing,
  request: { system: string; messages: AiMessage[]; tools: AiToolSpec[]; maxOutputTokens: number },
): number {
  const bytes = Buffer.byteLength(JSON.stringify({ system: request.system, messages: request.messages, tools: request.tools }), "utf8");
  return costMicroUsd(pricing, { inputTokens: bytes + PROMPT_OVERHEAD_TOKENS, outputTokens: request.maxOutputTokens });
}

const toolResultText = (result: ToolResult) =>
  JSON.stringify(result.ok ? { data: result.data } : { error: result.error });

/**
 * The AI Gateway: the only code that talks to a model. Enforces the budget (an atomic worst-case reservation before
 * every call, settled to the actual cost afterwards), wall-clock and
 * per-call timeouts, a bounded tool loop, schema validation of the final answer, and records usage and cost for every
 * call. It never throws for provider problems: callers get a typed failure and fall back to deterministic behaviour.
 */
export function createAiGateway(config: AiGatewayConfig): AiGateway {
  const provider = config.provider;
  return {
    available: provider !== null && config.monthlyBudgetMicroUsd > 0,
    model: provider?.model ?? null,

    async runAgent<T>(db: DbExecutor, request: AgentRunRequest<T>): Promise<AgentRun<T>> {
      const toolCalls: { name: string; ok: boolean }[] = [];
      if (!provider || config.monthlyBudgetMicroUsd <= 0) return { status: "unavailable", model: null, toolCalls };

      const correlationId = currentCorrelationId();
      const log = logger.child({ feature: request.feature, model: provider.model, correlationId });
      const record = (entry: { status: "succeeded" | "failed" | "timeout" | "refused" | "invalid_output" | "budget_exceeded"; inputTokens?: number; outputTokens?: number; latencyMs?: number; errorCode?: string }) =>
        recordAiUsage(db, {
          feature: request.feature,
          provider: provider.name,
          model: provider.model,
          organizationId: request.attribution?.organizationId ?? null,
          userId: request.attribution?.userId ?? null,
          correlationId,
          inputTokens: entry.inputTokens ?? 0,
          outputTokens: entry.outputTokens ?? 0,
          costMicroUsd: costMicroUsd(config.pricing, { inputTokens: entry.inputTokens ?? 0, outputTokens: entry.outputTokens ?? 0 }),
          latencyMs: entry.latencyMs ?? 0,
          status: entry.status,
          errorCode: entry.errorCode ?? null,
        }).catch((error) => log.error("failed to record AI usage", { error }));

      const finalSpec: AiToolSpec = { name: request.final.name, description: request.final.description, inputSchema: jsonSchema(request.final.schema) };
      const tools = new Map(request.tools.map((t) => [t.name, t]));
      const specs: AiToolSpec[] = [...request.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })), finalSpec];
      const messages: AiMessage[] = [{ role: "user", content: [{ type: "text", text: request.prompt }] }];
      const deadline = Date.now() + config.runTimeoutMs;
      const maxSteps = request.maxSteps ?? 4;
      const maxToolCalls = request.maxToolCalls ?? 8;
      let finalAttempts = 0;

      const maxOutputTokens = request.maxOutputTokens ?? 2048;
      const settle = (reservationId: string, outcome: Parameters<typeof settleAiUsage>[2]) =>
        settleAiUsage(db, reservationId, outcome).catch((error) => log.error("failed to settle AI usage; reservation kept", { error }));

      for (let step = 0; step < maxSteps; step++) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return { status: "timeout", model: provider.model, toolCalls };

        // Reserve the worst case before calling: concurrent requests cannot jointly exceed the budget.
        const reserveMicroUsd = maxCallCostMicroUsd(config.pricing, { system: request.system, messages, tools: specs, maxOutputTokens });
        const reservation = await reserveAiBudget(
          db,
          {
            feature: request.feature,
            provider: provider.name,
            model: provider.model,
            organizationId: request.attribution?.organizationId ?? null,
            userId: request.attribution?.userId ?? null,
            correlationId,
            reserveMicroUsd,
          },
          config.monthlyBudgetMicroUsd,
        );
        if (!reservation) {
          await record({ status: "budget_exceeded" });
          log.warn("AI budget exhausted; falling back", { reserveMicroUsd });
          return { status: "budget_exceeded", model: provider.model, toolCalls };
        }

        const started = Date.now();
        let response;
        try {
          response = await provider.complete({
            system: request.system,
            messages,
            tools: specs,
            maxOutputTokens,
            signal: AbortSignal.timeout(remaining),
          });
        } catch (error) {
          const kind = error instanceof AiProviderError ? error.kind : "unavailable";
          // A rejected or rate-limited request is not billed. After a timeout or a dropped connection the provider may
          // still have billed the call, so the reserved worst case is kept as its cost.
          const billed = kind === "timeout" || kind === "unavailable";
          await settle(reservation.id, {
            status: kind === "timeout" ? "timeout" : "failed",
            inputTokens: 0,
            outputTokens: 0,
            costMicroUsd: billed ? reservation.reservedMicroUsd : 0,
            latencyMs: Date.now() - started,
            errorCode: kind,
          });
          log.warn("AI call failed", { kind });
          return { status: kind === "timeout" ? "timeout" : "failed", model: provider.model, toolCalls };
        }
        const latencyMs = Date.now() - started;
        const usage = { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens, latencyMs };
        const actual = { ...usage, costMicroUsd: costMicroUsd(config.pricing, usage), errorCode: null };

        if (response.stopReason === "refusal") {
          await settle(reservation.id, { status: "refused", ...actual });
          return { status: "refused", model: provider.model, toolCalls };
        }
        await settle(reservation.id, { status: "succeeded", ...actual });
        if (actual.costMicroUsd > reservation.reservedMicroUsd) {
          log.error("AI call cost more than its reservation", { reserved: reservation.reservedMicroUsd, actual: actual.costMicroUsd });
        }
        log.info("AI call", { step, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, latencyMs });
        messages.push(response.message);

        const calls = response.message.content.filter((b) => b.type === "tool_call");
        const final = calls.find((c) => c.name === request.final.name);
        if (final) {
          const parsed = request.final.schema.safeParse(final.input);
          if (parsed.success) return { status: "completed", result: parsed.data, model: provider.model, toolCalls };
          finalAttempts++;
          if (finalAttempts > 1) {
            await record({ status: "invalid_output" });
            return { status: "invalid_output", model: provider.model, toolCalls };
          }
        }

        const results = await Promise.all(
          calls.map(async (call) => {
            if (call.name === request.final.name) {
              return { type: "tool_result" as const, toolCallId: call.id, isError: true, content: JSON.stringify({ error: { code: "VALIDATION_FAILED", message: "The answer does not match the required schema." } }) };
            }
            const tool = tools.get(call.name);
            if (!tool || toolCalls.length >= maxToolCalls) {
              toolCalls.push({ name: call.name, ok: false });
              return { type: "tool_result" as const, toolCallId: call.id, isError: true, content: JSON.stringify({ error: { code: tool ? "LIMIT" : "UNKNOWN_TOOL", message: tool ? "Tool call limit reached; answer now." : "No such tool." } }) };
            }
            const result = await tool.run(call.input).catch((): ToolResult => ({ ok: false, error: { code: "INTERNAL", message: "The tool failed." } }));
            toolCalls.push({ name: call.name, ok: result.ok });
            return { type: "tool_result" as const, toolCallId: call.id, isError: !result.ok, content: toolResultText(result) };
          }),
        );

        if (results.length === 0) {
          messages.push({ role: "user", content: [{ type: "text", text: `Use the ${request.final.name} tool to give your answer.` }] });
        } else {
          messages.push({ role: "user", content: results });
        }
      }
      return { status: "step_limit", model: provider.model, toolCalls };
    },
  };
}
