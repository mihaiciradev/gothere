import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/infrastructure/db/client";
import { type Actor, getActor } from "@/modules/identity";
import { type OrganizationRole, listMemberships, roleGrants } from "@/modules/organizations";

export type OrganizerContext = {
  actor: Actor;
  organization: { id: string; slug: string; name: string; role: OrganizationRole };
  memberships: { id: string; slug: string; name: string; role: OrganizationRole }[];
  can: (permission: Parameters<typeof roleGrants>[1]) => boolean;
  /** Appends `?org=` when the person belongs to more than one organization, so links keep the selection. */
  href: (path: string) => string;
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Resolves the signed-in organiser and the selected organization (`?org=slug`, default: first membership).
 * Membership and role come from the database; the query parameter only chooses among the person's own memberships.
 * Returns null when the person belongs to no organization. Must run inside a Suspense boundary.
 */
export async function organizerContext(searchParams: SearchParams, returnTo: string): Promise<OrganizerContext | null> {
  const actor = await getActor(await headers());
  if (!actor) redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`);
  const memberships = await listMemberships(getDb(), actor);
  if (memberships.length === 0) return null;
  const requested = (await searchParams).org;
  const slug = Array.isArray(requested) ? requested[0] : requested;
  const organization = memberships.find((m) => m.slug === slug) ?? memberships[0]!;
  return {
    actor,
    organization,
    memberships,
    can: (permission) => roleGrants(organization.role, permission),
    href: (path) => (memberships.length > 1 ? `${path}${path.includes("?") ? "&" : "?"}org=${organization.slug}` : path),
  };
}
