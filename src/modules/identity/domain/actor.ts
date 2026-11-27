export const platformRoles = ["attendee", "platform_admin"] as const;
export type PlatformRole = (typeof platformRoles)[number];

/** The authenticated principal. Always resolved server-side from the session, never from client input. */
export type Actor = Readonly<{
  kind: "user";
  userId: string;
  email: string;
  platformRole: PlatformRole;
}>;

export function toPlatformRole(value: unknown): PlatformRole {
  return value === "platform_admin" ? "platform_admin" : "attendee";
}
