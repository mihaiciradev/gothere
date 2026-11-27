/** Provider-neutral conversation primitives. Adapters translate them; nothing outside `ai/providers` sees an SDK type. */

export type AiContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolCallId: string; content: string; isError?: boolean };

export type AiMessage = {
  role: "user" | "assistant";
  content: AiContentBlock[];
  /** Provider-native assistant content (e.g. reasoning blocks) replayed verbatim to the same provider. */
  native?: unknown;
};

export type AiToolSpec = { name: string; description: string; inputSchema: Record<string, unknown> };

export type AiTurnRequest = {
  system: string;
  messages: AiMessage[];
  tools: AiToolSpec[];
  maxOutputTokens: number;
  signal: AbortSignal;
};

export type AiStopReason = "end" | "tool_use" | "max_tokens" | "refusal" | "other";

export type AiTurnResponse = {
  stopReason: AiStopReason;
  message: AiMessage;
  usage: { inputTokens: number; outputTokens: number };
};

export type AiProvider = {
  readonly name: string;
  readonly model: string;
  complete(request: AiTurnRequest): Promise<AiTurnResponse>;
};

export type AiFailureKind = "timeout" | "rate_limited" | "unavailable" | "rejected";

/** Raised by adapters with a classified cause; the message is never shown to users. */
export class AiProviderError extends Error {
  constructor(
    readonly kind: AiFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

/** Integer micro-USD per million tokens, so cost arithmetic stays in integers. */
export type AiPricing = { inputMicroUsdPerMTok: number; outputMicroUsdPerMTok: number };
