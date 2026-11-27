import { randomUUID } from "node:crypto";
import { serverEnv } from "@/infrastructure/env";
import type { DemandSubject } from "@/modules/analytics";
import type { Actor } from "@/modules/identity";
import { isUuid } from "@/shared/ids";

const COOKIE = "gt_vid";

/**
 * Pseudonymous first-party visitor id, used only to count distinct interest and to rate-limit anonymous concierge use.
 * Random, HttpOnly, never sent to third parties and hashed before it is stored.
 */
export function visitorSubject(request: Request, actor: Actor | null): { subject: DemandSubject; setCookie: string | null } {
  if (actor) return { subject: { userId: actor.userId }, setCookie: null };
  const existing = request.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (existing && isUuid(existing)) return { subject: { visitorId: existing }, setCookie: null };
  const id = randomUUID();
  const secure = serverEnv().BETTER_AUTH_URL.startsWith("https://") ? "; Secure" : "";
  return { subject: { visitorId: id }, setCookie: `${COOKIE}=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}` };
}

export function withCookie(response: Response, setCookie: string | null): Response {
  if (setCookie) response.headers.append("set-cookie", setCookie);
  return response;
}
