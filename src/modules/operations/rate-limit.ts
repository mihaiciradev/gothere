import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/client";
import { AppError } from "@/shared/errors";

/** Fixed-window counter stored in PostgreSQL, so limits hold across serverless instances. */
export async function consumeRateLimit(
  db: DbExecutor,
  key: string,
  policy: { limit: number; windowSeconds: number },
): Promise<void> {
  const result = await db.execute<{ count: number }>(sql`
    INSERT INTO api_rate_limits (key, window_start, count) VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN api_rate_limits.window_start <= now() - make_interval(secs => ${policy.windowSeconds})
                   THEN 1 ELSE api_rate_limits.count + 1 END,
      window_start = CASE WHEN api_rate_limits.window_start <= now() - make_interval(secs => ${policy.windowSeconds})
                   THEN now() ELSE api_rate_limits.window_start END
    RETURNING count`);
  if ((result.rows[0]?.count ?? 0) > policy.limit) {
    throw new AppError("RATE_LIMITED", "Too many requests. Please wait a moment and try again.");
  }
}
