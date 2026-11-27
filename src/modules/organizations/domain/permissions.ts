export const organizationRoles = ["owner", "manager", "analyst"] as const;
export type OrganizationRole = (typeof organizationRoles)[number];

export const organizationPermissions = [
  "organization.read",
  "organization.manage_members",
  "event.read",
  "event.write",
  "experience.write",
  "experience.publish",
  "inventory.write",
  "analytics.read",
  "recommendation.read",
  "action.approve",
] as const;
export type OrganizationPermission = (typeof organizationPermissions)[number];

const readOnly: readonly OrganizationPermission[] = [
  "organization.read",
  "event.read",
  "analytics.read",
  "recommendation.read",
];

const grants: Record<OrganizationRole, ReadonlySet<OrganizationPermission>> = {
  owner: new Set(organizationPermissions),
  manager: new Set([
    ...readOnly,
    "event.write",
    "experience.write",
    "experience.publish",
    "inventory.write",
    "action.approve",
  ]),
  analyst: new Set(readOnly),
};

export function roleGrants(role: OrganizationRole, permission: OrganizationPermission): boolean {
  return grants[role].has(permission);
}
