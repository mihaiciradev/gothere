import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { type Actor, getActor } from "@/modules/identity";

/** Current attendee or null. Reads the request, so callers must render inside a Suspense boundary. */
export async function currentActor(): Promise<Actor | null> {
  return getActor(await headers());
}

/** Redirects to sign-in, returning to `returnTo` afterwards (validated again on the sign-in page). */
export async function requireActorOrRedirect(returnTo: string): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`);
  return actor;
}
