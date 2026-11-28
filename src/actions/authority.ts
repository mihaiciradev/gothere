import type { DbExecutor } from "@/infrastructure/db/client";
import { requirePlatformAdminById } from "@/modules/identity";
import { requireOrganizationPermission } from "@/modules/organizations";
import { AppError } from "@/shared/errors";
import type { AnyAction } from "./types";

/**
 * Who may invoke or approve an action, decided from the database every time:
 * - organization scope: membership in the action's tenant with the action's permission (+ `action.approve` to approve);
 * - platform scope: the platform-admin role, re-read from the users table; there is no tenant.
 * Public actions need nothing to invoke and can never be approved (they never require approval).
 */
export async function requireActionAuthority(
  db: DbExecutor,
  userId: string,
  action: AnyAction,
  organizationId: string | null,
  purpose: "invoke" | "approve",
): Promise<void> {
  const actor = { kind: "user" as const, userId, email: "", platformRole: "attendee" as const };
  if (action.scope === "platform") {
    if (organizationId) throw new AppError("FORBIDDEN", "Platform actions have no organization context.");
    await requirePlatformAdminById(db, userId);
    return;
  }
  if (action.scope === "organization") {
    if (!organizationId || !action.permission) throw new AppError("FORBIDDEN", "This action needs an organization context.");
    await requireOrganizationPermission(db, actor, organizationId, action.permission);
    if (purpose === "approve") await requireOrganizationPermission(db, actor, organizationId, "action.approve");
    return;
  }
  if (purpose === "approve") throw new AppError("FORBIDDEN", "Public actions are never approved.");
}
