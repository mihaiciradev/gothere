import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatDateRange, formatDay, formatTime } from "@/components/format";
import { Photo } from "@/components/media/photo";
import { getDb } from "@/infrastructure/db/client";
import { listTicketsForUser } from "@/modules/ticketing";
import { requireActorOrRedirect } from "../_lib/session";

export const metadata: Metadata = { title: "My tickets", robots: { index: false } };

export default function TicketsPage() {
  return (
    <div className="container-edge pt-28 md:pt-36">
      <p className="label text-graphite-400">Wallet</p>
      <h1 className="mt-3 font-display text-display-lg font-semibold">My tickets</h1>
      <Suspense fallback={<div aria-busy="true" className="mt-12 h-96 animate-pulse bg-graphite-900/40" />}>
        <TicketList />
      </Suspense>
    </div>
  );
}

const statusCopy = { valid: "Valid", checked_in: "Used", void: "Void" } as const;

async function TicketList() {
  await connection();
  const actor = await requireActorOrRedirect("/tickets");
  const tickets = await listTicketsForUser(getDb(), actor);

  if (tickets.length === 0) {
    return (
      <div className="mt-12 border-t hairline py-20">
        <p className="font-display text-4xl font-semibold tracking-tight">No tickets yet.</p>
        <p className="mt-4 max-w-md text-graphite-300">When you buy tickets they appear here, each with its own code.</p>
        <Link href="/discover" className="mt-8 inline-flex items-center gap-6 bg-lime px-6 py-4 font-medium text-obsidian hover:bg-offwhite">
          Find something to go to <span aria-hidden>→</span>
        </Link>
      </div>
    );
  }

  const byEvent = new Map<string, typeof tickets>();
  for (const ticket of tickets) byEvent.set(ticket.event.id, [...(byEvent.get(ticket.event.id) ?? []), ticket]);

  return (
    <div className="mt-12 space-y-16">
      {[...byEvent.values()].map((group) => {
        const event = group[0]!.event;
        return (
          <section key={event.id} aria-labelledby={`event-${event.id}`} className="grid gap-8 border-t hairline pt-8 md:grid-cols-12">
            <div className="md:col-span-4">
              <Photo src={event.heroImageUrl} alt="" sizes="(min-width: 768px) 30vw, 100vw" className="aspect-[16/10]" credit={event.heroImageCredit} />
              <h2 id={`event-${event.id}`} className="mt-5 font-display text-3xl font-semibold tracking-tight">
                {event.title}
              </h2>
              <p className="mt-1 text-graphite-300">
                {formatDateRange(event.startsAt, event.endsAt, event.timeZone)} · {event.venueName}, {event.city}
              </p>
            </div>
            <ul className="border-t hairline md:col-span-8 md:border-t-0">
              {group.map((ticket) => (
                <li key={ticket.id} className="border-b hairline">
                  <Link href={`/tickets/${ticket.id}`} className="group flex items-center justify-between gap-6 py-5 md:first:pt-0">
                    <div className="min-w-0">
                      <p className="font-medium group-hover:text-lime">{ticket.itemName}</p>
                      <p className="mt-1 label text-graphite-400">
                        {ticket.experienceStartsAt
                          ? `${formatDay(ticket.experienceStartsAt, event.timeZone)} · ${formatTime(ticket.experienceStartsAt, event.timeZone)}`
                          : "Admission"}{" "}
                        · {ticket.code}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-4">
                      <span className={`label ${ticket.status === "valid" ? "text-lime" : "text-graphite-400"}`}>{statusCopy[ticket.status]}</span>
                      <span aria-hidden className="transition-transform group-hover:translate-x-1">→</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
