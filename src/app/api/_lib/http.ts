import { after } from "next/server";
import { ZodError } from "zod";
import { runOperationsCycle } from "@/composition/runtime";
import { serverEnv } from "@/infrastructure/env";
import { logger } from "@/infrastructure/logging/logger";
import { normalizeCorrelationId, runWithContext } from "@/infrastructure/request-context";
import { AppError, isAppError } from "@/shared/errors";

const MAX_BODY_BYTES = 32 * 1024;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function json(data: unknown, status = 200): Response {
  return Response.json({ data }, { status, headers: { "cache-control": "no-store" } });
}

function errorResponse(error: unknown, correlationId: string): Response {
  if (error instanceof ZodError) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_FAILED",
          message: "The request is invalid.",
          issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        correlationId,
      },
      { status: 422 },
    );
  }
  if (isAppError(error) && error.code !== "INTERNAL") {
    return Response.json(
      { error: { code: error.code, message: error.message, details: error.details }, correlationId },
      { status: error.httpStatus },
    );
  }
  logger.error("unhandled request error", { error });
  return Response.json(
    { error: { code: "INTERNAL", message: "Something went wrong." }, correlationId },
    { status: 500 },
  );
}

/**
 * CSRF defence for cookie-authenticated mutations: the browser-sent Origin (or Fetch Metadata) must be
 * our own origin. Requests without cookies are not cookie-authenticated and are left to their own auth.
 */
export function assertSameOrigin(request: Request): void {
  if (SAFE_METHODS.has(request.method) || !request.headers.get("cookie")) return;
  const allowed = new URL(serverEnv().BETTER_AUTH_URL).origin;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin ? origin === allowed : fetchSite === "same-origin") return;
  throw new AppError("FORBIDDEN", "Cross-site request rejected.", { reason: "csrf" });
}

export async function readJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) throw new AppError("VALIDATION_FAILED", "Request body too large.");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new AppError("VALIDATION_FAILED", "Request body too large.");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION_FAILED", "Request body must be valid JSON.");
  }
}

export function idempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key");
  if (!key) throw new AppError("VALIDATION_FAILED", "The Idempotency-Key header is required.");
  return key;
}

// Per-instance throttle: at most one opportunistic pass at a time and one per 5 s. Not a correctness
// mechanism (expiry and acceptance use the database clock); it only prevents polling stampedes.
let passRunning = false;
let lastPassAt = 0;

/** Runs a maintenance pass after the response is sent, when the platform supports it. Best effort only. */
export function kickOperations(): void {
  if (passRunning || Date.now() - lastPassAt < 5_000) return;
  passRunning = true;
  lastPassAt = Date.now();
  try {
    after(async () => {
      try {
        await runOperationsCycle(undefined, { jobLimit: 10 });
      } catch (error) {
        logger.warn("background operations pass failed", { error });
      } finally {
        passRunning = false;
      }
    });
  } catch {
    // Outside a request scope (e.g. tests): nothing to schedule.
    passRunning = false;
  }
}

type Handler<P> = (input: { request: Request; params: P; correlationId: string }) => Promise<Response>;

/** Every API route goes through this: correlation id, CSRF check, uniform error mapping. */
export function route<P extends Record<string, string> = Record<string, never>>(
  handler: Handler<P>,
  options: { csrf?: boolean } = {},
) {
  return async (request: Request, context: { params: Promise<P> }): Promise<Response> => {
    const correlationId = normalizeCorrelationId(request.headers.get("x-request-id"));
    return runWithContext({ correlationId }, async () => {
      let response: Response;
      try {
        if (options.csrf !== false) assertSameOrigin(request);
        response = await handler({ request, params: await context.params, correlationId });
      } catch (error) {
        response = errorResponse(error, correlationId);
      }
      response.headers.set("x-request-id", correlationId);
      return response;
    });
  };
}
