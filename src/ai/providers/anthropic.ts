import Anthropic from "@anthropic-ai/sdk";
import { type AiContentBlock, type AiMessage, type AiProvider, AiProviderError, type AiStopReason, type AiTurnRequest } from "../types";

export type AnthropicProviderConfig = { apiKey: string; model: string; timeoutMs: number };

function toParam(message: AiMessage): Anthropic.MessageParam {
  if (message.role === "assistant" && message.native) {
    return { role: "assistant", content: message.native as Anthropic.ContentBlockParam[] };
  }
  const content: Anthropic.ContentBlockParam[] = message.content.map((block) => {
    switch (block.type) {
      case "text":
        return { type: "text", text: block.text };
      case "tool_call":
        return { type: "tool_use", id: block.id, name: block.name, input: block.input };
      case "tool_result":
        return { type: "tool_result", tool_use_id: block.toolCallId, content: block.content, is_error: block.isError };
    }
  });
  return { role: message.role, content };
}

const stopReasons: Partial<Record<NonNullable<Anthropic.Message["stop_reason"]>, AiStopReason>> = {
  end_turn: "end",
  tool_use: "tool_use",
  max_tokens: "max_tokens",
  refusal: "refusal",
};

function classify(error: unknown): AiProviderError {
  if (error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIUserAbortError) {
    return new AiProviderError("timeout", "provider request timed out");
  }
  if (error instanceof Anthropic.RateLimitError) return new AiProviderError("rate_limited", "provider rate limit");
  if (error instanceof Anthropic.APIConnectionError || error instanceof Anthropic.InternalServerError) {
    return new AiProviderError("unavailable", "provider unavailable");
  }
  if (error instanceof Anthropic.APIError) return new AiProviderError("rejected", `provider rejected the request (${error.status})`);
  return new AiProviderError("unavailable", "provider call failed");
}

/** Anthropic Messages API through the official SDK. One bounded retry, short timeouts, low effort. */
export function createAnthropicProvider(config: AnthropicProviderConfig): AiProvider {
  const client = new Anthropic({ apiKey: config.apiKey, timeout: config.timeoutMs, maxRetries: 1 });
  return {
    name: "anthropic",
    model: config.model,
    async complete(request: AiTurnRequest) {
      let response: Anthropic.Message;
      try {
        response = await client.messages.create(
          {
            model: config.model,
            max_tokens: request.maxOutputTokens,
            system: request.system,
            messages: request.messages.map(toParam),
            tools: request.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema })),
            output_config: { effort: "low" },
          },
          { signal: request.signal },
        );
      } catch (error) {
        throw classify(error);
      }
      const content: AiContentBlock[] = [];
      for (const block of response.content) {
        if (block.type === "text") content.push({ type: "text", text: block.text });
        else if (block.type === "tool_use") content.push({ type: "tool_call", id: block.id, name: block.name, input: block.input });
      }
      return {
        stopReason: (response.stop_reason && stopReasons[response.stop_reason]) ?? "other",
        message: { role: "assistant", content, native: response.content },
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      };
    },
  };
}
