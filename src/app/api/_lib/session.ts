import { getDb } from "@/infrastructure/db/client";
import { type Actor, requireActor } from "@/modules/identity";
import { consumeRateLimit } from "@/modules/operations";

export function actorFrom(request: Request): Promise<Actor> {
  return requireActor(request.headers);
}

export const limits = {
  reservationCreate: { limit: 20, windowSeconds: 60 },
  paymentStart: { limit: 10, windowSeconds: 60 },
  organizerWrite: { limit: 60, windowSeconds: 60 },
  demandWrite: { limit: 20, windowSeconds: 60 },
  agentRun: { limit: 6, windowSeconds: 60 },
} as const;

export function limit(actor: Actor, bucket: keyof typeof limits): Promise<void> {
  return consumeRateLimit(getDb(), `${bucket}:${actor.userId}`, limits[bucket]);
}
