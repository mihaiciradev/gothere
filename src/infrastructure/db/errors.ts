type PgError = { code?: string; constraint?: string };

function pgError(error: unknown): PgError | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as PgError & { cause?: unknown };
  if (typeof e.code === "string") return e;
  return pgError(e.cause);
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pg = pgError(error);
  return pg?.code === "23505" && (!constraint || pg.constraint === constraint);
}

export function isForeignKeyViolation(error: unknown): boolean {
  return pgError(error)?.code === "23503";
}
