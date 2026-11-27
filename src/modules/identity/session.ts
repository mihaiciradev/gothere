import { getAuth } from "@/infrastructure/auth";
import { AppError } from "@/shared/errors";
import { type Actor, toPlatformRole } from "./domain/actor";

export async function getActor(headers: Headers): Promise<Actor | null> {
  const session = await getAuth().api.getSession({ headers });
  if (!session) return null;
  return {
    kind: "user",
    userId: session.user.id,
    email: session.user.email,
    platformRole: toPlatformRole((session.user as { platformRole?: unknown }).platformRole),
  };
}

export async function requireActor(headers: Headers): Promise<Actor> {
  const actor = await getActor(headers);
  if (!actor) throw new AppError("UNAUTHENTICATED", "Sign in to continue.");
  return actor;
}

export function requirePlatformAdmin(actor: Actor): void {
  if (actor.platformRole !== "platform_admin") {
    throw new AppError("FORBIDDEN", "Platform administrator access required.");
  }
}
