import { getDb } from "../db/client";
import { serverEnv } from "../env";
import { type Auth, createAuth } from "./auth";

let instance: Auth | undefined;

export function getAuth(): Auth {
  if (!instance) {
    const env = serverEnv();
    instance = createAuth({
      db: getDb(),
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.BETTER_AUTH_URL,
      production: env.APP_ENV === "production" || env.APP_ENV === "preview",
      rateLimitEnabled: env.APP_ENV !== "test",
    });
  }
  return instance;
}

export { createAuth, type Auth, type AuthConfig } from "./auth";
