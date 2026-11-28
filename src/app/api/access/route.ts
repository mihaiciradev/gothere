import { getDb } from "@/infrastructure/db/client";
import { ACCESS_COOKIE, ACCESS_TTL_SECONDS, gateMode, issueAccessToken, passwordMatches } from "@/infrastructure/access-gate";
import { consumeRateLimit } from "@/modules/operations";
import { isAppError } from "@/shared/errors";
import { safeRedirectPath } from "@/shared/redirect";
import { route } from "../_lib/http";

/** A mutable 303 (Response.redirect has immutable headers; the route wrapper adds a request id). */
function seeOther(location: URL): Response {
  return new Response(null, { status: 303, headers: { location: location.toString(), "cache-control": "no-store" } });
}

/** Form POST from /access: `password`, `next`. Rate-limited per IP; the password is compared in constant time. */
export const POST = route(async ({ request }) => {
  const form = await request.formData();
  const next = safeRedirectPath(String(form.get("next") ?? "/"), "/");
  const back = (error: string) =>
    seeOther(new URL(`/access?error=${error}&next=${encodeURIComponent(next)}`, request.url));

  if (gateMode(process.env) !== "on") return seeOther(new URL(next, request.url));
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  try {
    await consumeRateLimit(getDb(), `site-access:${ip}`, { limit: 10, windowSeconds: 600 });
  } catch (error) {
    if (isAppError(error) && error.code === "RATE_LIMITED") return back("rate");
    throw error;
  }
  const password = process.env.SITE_ACCESS_PASSWORD!;
  if (!passwordMatches(String(form.get("password") ?? ""), password)) return back("invalid");

  const token = issueAccessToken({ secret: process.env.BETTER_AUTH_SECRET!, password });
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const response = seeOther(new URL(next, request.url));
  response.headers.append("set-cookie", `${ACCESS_COOKIE}=${token}; Path=/; Max-Age=${ACCESS_TTL_SECONDS}; HttpOnly; SameSite=Lax${secure}`);
  return response;
});
