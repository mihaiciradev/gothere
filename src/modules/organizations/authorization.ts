import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/client";
import { organizationMemberships, organizations } from "@/infrastructure/db/schema";
import type { Actor } from "@/modules/identity";
import { AppError } from "@/shared/errors";
import { type OrganizationPermission, type OrganizationRole, roleGrants } from "./domain/permissions";

export type OrganizationContext = Readonly<{
  organizationId: string;
  actor: Actor;
  role: OrganizationRole;
}>;

/**
 * The only way to obtain an OrganizationContext. Membership is read from the database on every call;
 * client-supplied roles or tenant claims are never trusted. Non-members get NOT_FOUND so tenant
 * existence is not disclosed; members lacking the permission get FORBIDDEN.
 */
export async function requireOrganizationPermission(
  db: DbExecutor,
  actor: Actor,
  organizationId: string,
  permission: OrganizationPermission,
): Promise<OrganizationContext> {
  const [membership] = await db
    .select({ role: organizationMemberships.role })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, actor.userId),
      ),
    )
    .limit(1);

  if (!membership) throw new AppError("NOT_FOUND", "Organization not found.");
  if (!roleGrants(membership.role, permission)) {
    throw new AppError("FORBIDDEN", "You do not have permission for this action.", { permission });
  }
  return { organizationId, actor, role: membership.role };
}

/** Organizations the actor belongs to, with their role. Read from the database on every call. */
export async function listMemberships(db: DbExecutor, actor: Actor) {
  return db
    .select({ id: organizations.id, slug: organizations.slug, name: organizations.name, role: organizationMemberships.role })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(eq(organizationMemberships.userId, actor.userId))
    .orderBy(organizations.name);
}
