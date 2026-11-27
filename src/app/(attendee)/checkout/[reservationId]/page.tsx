import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatDateRange } from "@/components/format";
import { getDb } from "@/infrastructure/db/client";
import { serverEnv, simulatorScenariosEnabled } from "@/infrastructure/env";
import { getEventsByIds } from "@/modules/events";
import { listPaymentAttempts } from "@/modules/payments";
import { getReservationForOwner } from "@/modules/reservations";
import { findOrderForReservation } from "@/modules/ticketing";
import { isAppError } from "@/shared/errors";
import { requireActorOrRedirect } from "../../_lib/session";
import { CheckoutClient } from "./checkout-client";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

type Params = Promise<{ reservationId: string }>;

export default function CheckoutPage({ params }: { params: Params }) {
  return (
    <div className="container-edge pt-28 md:pt-36">
      <Suspense fallback={<div aria-busy="true" className="h-[60vh] animate-pulse bg-graphite-900/40" />}>
        <Checkout params={params} />
      </Suspense>
    </div>
  );
}

async function Checkout({ params }: { params: Params }) {
  await connection();
  const { reservationId } = await params;
  const actor = await requireActorOrRedirect(`/checkout/${reservationId}`);
  const db = getDb();

  // Owner-only, and lazily expires an overdue hold before anything is shown.
  const reservation = await getReservationForOwner(db, actor, reservationId).catch((error: unknown) => {
    if (isAppError(error) && (error.code === "NOT_FOUND" || error.code === "VALIDATION_FAILED")) notFound();
    throw error;
  });
  const [payments, order, [event]] = await Promise.all([
    listPaymentAttempts(db, reservation.id),
    findOrderForReservation(db, reservation.id),
    getEventsByIds(db, [reservation.eventId]),
  ]);
  if (!event) notFound();

  return (
    <CheckoutClient
      scenariosEnabled={simulatorScenariosEnabled(serverEnv())}
      event={{
        title: event.title,
        slug: event.slug,
        when: formatDateRange(event.startsAt, event.endsAt, event.timeZone),
        venue: `${event.venueName}, ${event.city}`,
      }}
      initial={{
        id: reservation.id,
        status: reservation.status,
        expiresAt: reservation.expiresAt.toISOString(),
        secondsRemaining: reservation.secondsRemaining,
        totalMinor: reservation.totalMinor,
        currency: reservation.currency,
        items: reservation.items,
        payments: payments.map((p) => ({
          id: p.id,
          status: p.status,
          disposition: p.disposition,
          amountMinor: p.amountMinor,
          currency: p.currency,
          failureCode: p.failureCode,
          createdAt: p.createdAt.toISOString(),
        })),
        orderId: order?.id ?? null,
      }}
    />
  );
}
