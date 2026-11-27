import { type ActionContext, getAction, invokeAction } from "@/actions";
import { toPublicError } from "@/shared/errors";
import { type AgentTool, type ToolResult, jsonSchema } from "./gateway";

/** Tool names must match ^[a-zA-Z0-9_-]+$; action ids use dots. */
export const toolName = (actionId: string) => actionId.replace(/\./g, "_");

/**
 * Exposes a registered action to the model. The tool runs through the same executor as every other caller, with the
 * caller's own actor and server-side tenant; the model controls only the (validated) input.
 */
export function actionTool(ctx: ActionContext, actionId: string, observe?: (output: unknown) => void): AgentTool {
  const action = getAction(actionId);
  return {
    name: toolName(actionId),
    description: action.description,
    inputSchema: jsonSchema(action.input),
    async run(input): Promise<ToolResult> {
      try {
        const outcome = await invokeAction(ctx, actionId, input);
        if (outcome.status === "pending_approval") {
          return {
            ok: true,
            data: {
              status: "pending_approval",
              requestId: outcome.request.id,
              summary: outcome.request.summary,
              note: "A human must approve this in the approval inbox. You cannot approve it.",
            },
          };
        }
        observe?.(outcome.output);
        return { ok: true, data: outcome.output };
      } catch (error) {
        return { ok: false, error: toPublicError(error) };
      }
    },
  };
}
