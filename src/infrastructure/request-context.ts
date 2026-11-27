import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type RequestContext = Readonly<{ correlationId: string }>;

const storage = new AsyncLocalStorage<RequestContext>();

const VALID_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/** Accepts a caller-supplied id only if it is well-formed; otherwise generates one. */
export function normalizeCorrelationId(candidate: string | null | undefined): string {
  return candidate && VALID_ID.test(candidate) ? candidate : randomUUID();
}

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
