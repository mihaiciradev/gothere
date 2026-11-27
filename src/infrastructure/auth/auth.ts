import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import type { Database } from "../db/client";
import { accounts, rateLimits, sessions, users, verifications } from "../db/schema";

export type AuthConfig = {
  db: Database;
  secret: string;
  baseURL: string;
  production: boolean;
  rateLimitEnabled: boolean;
};

export function createAuth(config: AuthConfig) {
  return betterAuth({
    appName: "gothere",
    secret: config.secret,
    baseURL: config.baseURL,
    trustedOrigins: [config.baseURL],
    database: drizzleAdapter(config.db, {
      provider: "pg",
      schema: { user: users, session: sessions, account: accounts, verification: verifications, rateLimit: rateLimits },
    }),
    user: {
      additionalFields: {
        // Never accepted from client input; changed only by server-side administration.
        platformRole: { type: "string", required: false, defaultValue: "attendee", input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      // No email provider in the MVP. Documented in docs/security.md.
      requireEmailVerification: false,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: config.rateLimitEnabled,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
      },
    },
    advanced: {
      cookiePrefix: "gothere",
      useSecureCookies: config.production,
      database: { generateId: "uuid" },
    },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
