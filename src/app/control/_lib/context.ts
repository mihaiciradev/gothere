import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/infrastructure/db/client";
import { type Actor, getActor, requirePlatformAdminById } from "@/modules/identity";
import { isAppError } from "@/shared/errors";

/**
 * Signed-in platform administrator, re-checked against the database. Signed-out visitors go to sign-in; signed-in
 * non-admins get the not-found page and no data. Must run inside Suspense.
 */
export async function controlActor(returnTo: string): Promise<Actor> {
  const actor = await getActor(await headers());
  if (!actor) redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`);
  try {
    await requirePlatformAdminById(getDb(), actor.userId);
  } catch (error) {
    if (isAppError(error) && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) notFound();
    throw error;
  }
  return actor;
}
