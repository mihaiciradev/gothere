import { AppError } from "./errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Malformed ids are indistinguishable from missing resources (404), never a database error (500). */
export function assertUuid(value: unknown, entity: string): asserts value is string {
  if (!isUuid(value)) throw new AppError("NOT_FOUND", `${entity} not found.`);
}
