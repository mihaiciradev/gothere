export const errorCodes = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "RATE_LIMITED",
  "UNAVAILABLE",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof errorCodes)[number];

const httpStatus: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "AppError";
  }

  get httpStatus(): number {
    return httpStatus[this.code];
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Safe, client-facing representation. Internal errors never leak their message. */
export function toPublicError(error: unknown): { code: ErrorCode; message: string } {
  if (isAppError(error) && error.code !== "INTERNAL") {
    return { code: error.code, message: error.message };
  }
  return { code: "INTERNAL", message: "Something went wrong." };
}
