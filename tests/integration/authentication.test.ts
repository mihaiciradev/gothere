import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createAuth } from "@/infrastructure/auth/auth";
import { users } from "@/infrastructure/db/schema";
import { openTestDatabase } from "./support/fixtures";

const { db, pool } = openTestDatabase();
afterAll(() => pool.end());

const baseURL = "http://localhost:3000";
const auth = createAuth({
  db,
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL,
  production: false,
  rateLimitEnabled: false,
});

const post = (path: string, body: unknown) =>
  auth.handler(
    new Request(`${baseURL}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseURL },
      body: JSON.stringify(body),
    }),
  );

const password = "correct-horse-battery-staple";
const uniqueEmail = (prefix: string) => `${prefix}-${crypto.randomUUID()}@example.test`;

describe("authentication", () => {
  it("never grants a privileged role supplied by the client at sign-up", async () => {
    const email = uniqueEmail("signup");
    const response = await post("/sign-up/email", { name: "New Attendee", email, password, platformRole: "platform_admin" });

    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (user) expect(user.platformRole).toBe("attendee");
    else expect(response.status).toBe(400);
  });

  it("issues an HttpOnly session cookie and resolves the session server-side", async () => {
    const email = uniqueEmail("signin");
    expect((await post("/sign-up/email", { name: "Session User", email, password })).status).toBe(200);

    const signIn = await post("/sign-in/email", { email, password });
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.get("set-cookie");
    expect(cookie).toContain("gothere.session_token");
    expect(cookie?.toLowerCase()).toContain("httponly");
    expect(cookie?.toLowerCase()).toContain("samesite=lax");

    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookie!.split(";")[0]! }) });
    expect(session?.user.email).toBe(email);
  });

  it("rejects invalid credentials without revealing which part was wrong", async () => {
    const email = uniqueEmail("wrong");
    await post("/sign-up/email", { name: "Wrong Password", email, password });

    const wrongPassword = await post("/sign-in/email", { email, password: "not-the-password-123" });
    const unknownUser = await post("/sign-in/email", { email: uniqueEmail("nobody"), password });
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    const [a, b] = (await Promise.all([wrongPassword.json(), unknownUser.json()])) as { code: string }[];
    expect(a!.code).toBe(b!.code);
  });

  it("enforces the minimum password length", async () => {
    const response = await post("/sign-up/email", { name: "Short", email: uniqueEmail("short"), password: "short" });
    expect(response.status).toBe(400);
  });
});
