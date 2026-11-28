import { eq } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/client";
import { users } from "@/infrastructure/db/schema";
import { AppError } from "@/shared/errors";

/**
 * Platform-admin check read from the database at the moment of use (a session's role can be stale, and approvals
 * re-check people who are not the current caller). Non-admins get FORBIDDEN; unknown users NOT_FOUND.
 */
export async function requirePlatformAdminById(db: DbExecutor, userId: string): Promise<void> {
  const [row] = await db.select({ role: users.platformRole }).from(users).where(eq(users.id, userId));
  if (!row) throw new AppError("NOT_FOUND", "User not found.");
  if (row.role !== "platform_admin") throw new AppError("FORBIDDEN", "Platform administrator access required.");
}
