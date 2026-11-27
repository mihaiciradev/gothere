import { createHash } from "node:crypto";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Database, DbExecutor, Transaction } from "@/infrastructure/db/client";
import { isUniqueViolation } from "@/infrastructure/db/errors";
import { inventoryItems, reservationItems, reservations } from "@/infrastructure/db/schema";
import { getEventForSale } from "@/modules/events";
import type { Actor } from "@/modules/identity";
import { type UnitLine, releaseUnits, reserveUnits } from "@/modules/inventory";
import { AppError } from "@/shared/errors";
import { assertUuid } from "@/shared/ids";
import {
  type ClosingStatus,
  MAX_ACTIVE_RESERVATIONS_PER_USER,
  RESERVATION_TTL_SECONDS,
  canonicalReservationRequest,
} from "./domain/policy";
import { createReservationSchema, idempotencyKeySchema } from "./schemas";

/** Advisory-lock namespace serializing reservation creation per user (cap and idempotency checks). */
const USER_RESERVATION_LOCK = 7301;

type ReservationRow = typeof reservations.$inferSelect;
export type LockedReservation = ReservationRow & { overdue: boolean };

export type ReservationView = {
  id: string;
  eventId: string;
  organizationId: string;
  status: ReservationRow["status"];
  currency: string;
  totalMinor: number;
  expiresAt: Date;
  /** Seconds until expiry by the database clock (0 once past). Clients count down from this, never from their own clock. */
  secondsRemaining: number;
  createdAt: Date;
  origin: ReservationRow["origin"];
  items: { inventoryItemId: string; name: string; quantity: number; unitPriceMinor: number }[];
};

const hashRequest = (canonical: string) => createHash("sha256").update(canonical).digest("hex");

export async function getReservationLines(db: DbExecutor, reservationId: string) {
  return db
    .select({
      inventoryItemId: reservationItems.inventoryItemId,
      quantity: reservationItems.quantity,
      unitPriceMinor: reservationItems.unitPriceMinor,
      name: inventoryItems.name,
    })
    .from(reservationItems)
    .innerJoin(inventoryItems, eq(inventoryItems.id, reservationItems.inventoryItemId))
    .where(eq(reservationItems.reservationId, reservationId))
    .orderBy(asc(reservationItems.inventoryItemId));
}

async function toView(db: DbExecutor, row: ReservationRow): Promise<ReservationView> {
  const clock = await db.execute<{ seconds: number }>(
    sql`SELECT greatest(0, floor(extract(epoch FROM (${row.expiresAt.toISOString()}::timestamptz - now()))))::int AS seconds`,
  );
  return {
    id: row.id,
    eventId: row.eventId,
    organizationId: row.organizationId,
    status: row.status,
    currency: row.currency,
    totalMinor: row.totalMinor,
    expiresAt: row.expiresAt,
    secondsRemaining: row.status === "active" ? (clock.rows[0]?.seconds ?? 0) : 0,
    createdAt: row.createdAt,
    origin: row.origin,
    items: await getReservationLines(db, row.id),
  };
}

async function findByIdempotencyKey(db: DbExecutor, userId: string, key: string) {
  const [row] = await db
    .select()
    .from(reservations)
    .where(and(eq(reservations.userId, userId), eq(reservations.idempotencyKey, key)));
  return row;
}

async function replay(db: DbExecutor, existing: ReservationRow, requestHash: string): Promise<ReservationView> {
  if (existing.requestHash !== requestHash) {
    throw new AppError("CONFLICT", "This Idempotency-Key was already used for a different request.", {
      reason: "idempotency_key_reused",
    });
  }
  return toView(db, existing);
}

/**
 * Creates a reservation or returns the one created earlier with the same Idempotency-Key and parameters.
 * The per-user advisory lock makes the active-reservation cap and the idempotency check atomic against
 * concurrent requests; inventory is reserved all-or-nothing in lock order within the same transaction.
 */
export async function createReservation(
  db: Database,
  actor: Actor,
  input: unknown,
  options: { idempotencyKey: unknown; origin?: "live" | "seed" },
): Promise<ReservationView> {
  const request = createReservationSchema.parse(input);
  const key = idempotencyKeySchema.parse(options.idempotencyKey);
  const requestHash = hashRequest(canonicalReservationRequest(request));

  const previous = await findByIdempotencyKey(db, actor.userId, key);
  if (previous) return replay(db, previous, requestHash);

  const event = await getEventForSale(db, request.eventId);
  const lines: UnitLine[] = request.items;
  await sweepOverdueReservations(db, { inventoryItemIds: lines.map((l) => l.inventoryItemId), limit: 50 });

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${USER_RESERVATION_LOCK}, hashtext(${actor.userId}))`);

      const raced = await findByIdempotencyKey(tx, actor.userId, key);
      if (raced) return replay(tx, raced, requestHash);

      const [active] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(reservations)
        .where(
          and(
            eq(reservations.userId, actor.userId),
            eq(reservations.status, "active"),
            sql`${reservations.expiresAt} > now()`,
          ),
        );
      if ((active?.count ?? 0) >= MAX_ACTIVE_RESERVATIONS_PER_USER) {
        throw new AppError("CONFLICT", "You already have the maximum number of active reservations.", {
          reason: "active_reservation_limit",
          limit: MAX_ACTIVE_RESERVATIONS_PER_USER,
        });
      }

      const priced = await reserveUnits(tx, event.id, lines);
      const currency = priced[0]!.currency;
      if (priced.some((line) => line.currency !== currency)) {
        throw new AppError("VALIDATION_FAILED", "All items in a reservation must share one currency.");
      }
      const totalMinor = priced.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0);

      const [reservation] = await tx
        .insert(reservations)
        .values({
          userId: actor.userId,
          organizationId: event.organizationId,
          eventId: event.id,
          currency,
          totalMinor,
          expiresAt: sql`now() + make_interval(secs => ${RESERVATION_TTL_SECONDS})`,
          idempotencyKey: key,
          requestHash,
          origin: options.origin ?? "live",
        })
        .returning();
      await tx.insert(reservationItems).values(
        priced.map((line) => ({
          reservationId: reservation!.id,
          eventId: event.id,
          inventoryItemId: line.inventoryItemId,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
        })),
      );
      return toView(tx, reservation!);
    });
  } catch (error) {
    if (isUniqueViolation(error, "reservations_user_idempotency_unique")) {
      const winner = await findByIdempotencyKey(db, actor.userId, key);
      if (winner) return replay(db, winner, requestHash);
    }
    throw error;
  }
}

/** Locks the reservation row; `overdue` is evaluated by the database clock. */
export async function lockReservation(tx: Transaction, reservationId: string, userId?: string): Promise<LockedReservation | undefined> {
  const [row] = await tx
    .select({ reservation: reservations, overdue: sql<boolean>`${reservations.expiresAt} <= now()` })
    .from(reservations)
    .where(userId ? and(eq(reservations.id, reservationId), eq(reservations.userId, userId)) : eq(reservations.id, reservationId))
    .for("update");
  return row ? { ...row.reservation, overdue: row.overdue } : undefined;
}

/**
 * The single transition out of `active`. Conditional on the current status, so concurrent closers
 * (expiry job, lazy expiry, payment confirmation, user release) cannot both succeed; units are
 * returned to inventory exactly once. `converted` leaves units held for the order to commit.
 */
export async function closeReservation(tx: Transaction, reservationId: string, to: ClosingStatus): Promise<boolean> {
  const closed = await tx
    .update(reservations)
    .set({ status: to, closedAt: sql`now()` })
    .where(and(eq(reservations.id, reservationId), eq(reservations.status, "active")))
    .returning({ id: reservations.id });
  if (closed.length === 0) return false;
  if (to !== "converted") await releaseUnits(tx, await getReservationLines(tx, reservationId));
  return true;
}

/** Expires a reservation if it is active and past its expiry. Safe to call concurrently and repeatedly. */
export async function expireReservation(db: Database, reservationId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const reservation = await lockReservation(tx, reservationId);
    if (!reservation || reservation.status !== "active" || !reservation.overdue) return false;
    return closeReservation(tx, reservationId, "expired");
  });
}

/** Expires overdue reservations, optionally only those holding the given items. Each in its own short transaction. */
export async function sweepOverdueReservations(
  db: Database,
  options: { inventoryItemIds?: string[]; limit?: number } = {},
): Promise<number> {
  const filter = options.inventoryItemIds?.length
    ? inArray(
        reservations.id,
        db
          .select({ id: reservationItems.reservationId })
          .from(reservationItems)
          .where(inArray(reservationItems.inventoryItemId, options.inventoryItemIds)),
      )
    : undefined;
  const overdue = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(and(eq(reservations.status, "active"), lte(reservations.expiresAt, sql`now()`), filter))
    .limit(options.limit ?? 100);

  let expired = 0;
  for (const { id } of overdue) if (await expireReservation(db, id)) expired += 1;
  return expired;
}

/** Owner-only read. Lazily expires an overdue reservation so callers never see a stale `active`. */
export async function getReservationForOwner(db: Database, actor: Actor, reservationId: string): Promise<ReservationView> {
  assertUuid(reservationId, "Reservation");
  const [row] = await db
    .select({ reservation: reservations, overdue: sql<boolean>`${reservations.expiresAt} <= now()` })
    .from(reservations)
    .where(and(eq(reservations.id, reservationId), eq(reservations.userId, actor.userId)));
  if (!row) throw new AppError("NOT_FOUND", "Reservation not found.");
  if (row.reservation.status === "active" && row.overdue) {
    await expireReservation(db, reservationId);
    const [fresh] = await db.select().from(reservations).where(eq(reservations.id, reservationId));
    return toView(db, fresh!);
  }
  return toView(db, row.reservation);
}

/** The attendee gives up a hold. Idempotent for an already released reservation. */
export async function releaseReservation(db: Database, actor: Actor, reservationId: string): Promise<ReservationView> {
  assertUuid(reservationId, "Reservation");
  return db.transaction(async (tx) => {
    const reservation = await lockReservation(tx, reservationId, actor.userId);
    if (!reservation) throw new AppError("NOT_FOUND", "Reservation not found.");
    if (reservation.status === "active") await closeReservation(tx, reservationId, "released");
    else if (reservation.status !== "released") {
      throw new AppError("PRECONDITION_FAILED", `Reservation is already ${reservation.status}.`, { status: reservation.status });
    }
    const [fresh] = await tx.select().from(reservations).where(eq(reservations.id, reservationId));
    return toView(tx, fresh!);
  });
}
