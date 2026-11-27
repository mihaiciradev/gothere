import { expect } from "vitest";

type PgError = { code?: string; constraint?: string; message?: string };

function pgError(error: unknown): PgError {
  const e = error as { cause?: PgError } & PgError;
  return e.cause?.code ? e.cause : e;
}

/** Asserts the promise is rejected by PostgreSQL, optionally by a specific named constraint. */
export async function expectDbRejection(promise: Promise<unknown>, constraint?: string): Promise<PgError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, "expected the database to reject the statement").toBeDefined();
  const pg = pgError(error);
  expect(pg.code, `unexpected error: ${pg.message}`).toBeDefined();
  if (constraint) expect(pg.constraint).toBe(constraint);
  return pg;
}
