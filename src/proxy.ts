import { type NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, gateMode, isUngatedPath, verifyAccessToken } from "@/infrastructure/access-gate";

/**
 * Temporary pre-release access gate (ADR-0011). Every page and API route requires a valid signed access cookie,
 * except the gate itself, the privacy notice and self-authenticating machine endpoints (payment webhooks, cron).
 * The check is server-side; nothing about the password reaches the browser. Off locally and in tests.
 */
export function proxy(request: NextRequest) {
  const mode = gateMode(process.env);
  if (mode === "off") return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (isUngatedPath(pathname)) return NextResponse.next();

  if (mode === "on") {
    const secret = process.env.BETTER_AUTH_SECRET!;
    const password = process.env.SITE_ACCESS_PASSWORD!;
    if (verifyAccessToken(request.cookies.get(ACCESS_COOKIE)?.value, { secret, password })) return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "This preview is password-protected." } },
      { status: 401, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } },
    );
  }
  const target = new URL("/access", request.url);
  target.searchParams.set("next", `${pathname}${search}`);
  const response = NextResponse.redirect(target, 303);
  response.headers.set("cache-control", "no-store");
  return response;
}

export const config = {
  // Static assets and image optimisation never need the gate (they carry no data).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
