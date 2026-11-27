const ALLOWED_SECTIONS = ["/discover", "/events", "/checkout", "/tickets"];

/**
 * Returns a same-origin relative path that is safe to redirect to after sign-in, or the fallback.
 * Rejects absolute and protocol-relative URLs (`//evil`), backslash tricks (`/\evil`), control characters,
 * and any path outside the attendee sections.
 */
export function safeRedirectPath(candidate: unknown, fallback = "/"): string {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 512) return fallback;
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return fallback;

  let resolved: URL;
  try {
    resolved = new URL(candidate, "https://gothere.invalid");
  } catch {
    return fallback;
  }
  if (resolved.origin !== "https://gothere.invalid") return fallback;

  const path = resolved.pathname;
  const allowed = path === "/" || ALLOWED_SECTIONS.some((section) => path === section || path.startsWith(`${section}/`));
  return allowed ? path + resolved.search + resolved.hash : fallback;
}
