/**
 * Sanitization for operational telemetry. Everything stored in incidents, sent to an AI model or packaged for an
 * external coding agent passes through here. Pure and unit-tested. It removes values, not structure: the report keeps
 * error names, codes, routes and correlation ids, which is what an investigator needs.
 */

const SECRET_KEY = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|card|iban|cvv|session|signature|email/i;
const MAX_STRING = 300;
const MAX_DEPTH = 4;
const MAX_ARRAY = 20;

const rules: [RegExp, string][] = [
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/gi, "[url-with-credentials]://"], // scheme://user:pass@
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[jwt]"],
  [/\b(sk|pk|rk|key)[-_][A-Za-z0-9_-]{16,}\b/g, "[api-key]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\b(?:\d[ -]?){13,19}\b/g, "[number]"], // card-like digit runs
  [/\b[A-Za-z0-9+/_-]{40,}={0,2}(?![A-Za-z0-9])/g, "[secret]"], // long opaque tokens (keeps 36-char UUIDs)
];

export function sanitizeText(value: string, max = MAX_STRING): string {
  let out = value;
  for (const [pattern, replacement] of rules) out = out.replace(pattern, replacement);
  out = out.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return sanitizeText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map((v) => sanitizeValue(v, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 40)
        .map(([k, v]) => [k, SECRET_KEY.test(k) ? "[redacted]" : sanitizeValue(v, depth + 1)]),
    );
  }
  return String(value);
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** `/api/reservations/3f2…/payments` → `/api/reservations/:id/payments`, so one failing route is one fingerprint. */
export function normalizePath(path: string): string {
  return path.split("?")[0]!.replace(UUID, ":id").replace(/\/\d+(?=\/|$)/g, "/:n").slice(0, 200);
}

/** The first few stack frames as `file:line`, inside the project only, without absolute paths or values. */
export function stackFrames(error: unknown, limit = 5): string[] {
  const stack = error instanceof Error ? (error.stack ?? "") : "";
  return stack
    .split("\n")
    .slice(1)
    .filter((line) => !/\bnode:/.test(line)) // Node internals (and "node:" would parse as a drive letter)
    .map((line) => line.match(/\(?((?:[A-Za-z]:)?[^():]+):(\d+):\d+\)?\s*$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map(([, file, line]) => `${file!.replace(/\\/g, "/").replace(/^.*?\/(src|\.next|node_modules)\//, "$1/")}:${line}`)
    .filter((f) => !f.startsWith("node:") && !f.includes("node_modules/"))
    .slice(0, limit);
}
