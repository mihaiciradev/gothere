import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import QRCode from "qrcode";
import { Suspense } from "react";
import { formatDateRange, formatDay, formatTime } from "@/components/format";
import { Photo } from "@/components/media/photo";
import { getDb } from "@/infrastructure/db/client";
import { getTicketForUser } from "@/modules/ticketing";
import { isAppError } from "@/shared/errors";
import { requireActorOrRedirect } from "../../_lib/session";

export const metadata: Metadata = { title: "Ticket", robots: { index: false } };

type Params = Promise<{ id: string }>;

export default function TicketPage({ params }: { params: Params }) {
  return (
    <div className="container-edge pt-24 md:pt-32">
      <Suspense fallback={<div aria-busy="true" className="mx-auto h-[80vh] max-w-md animate-pulse bg-graphite-900/40" />}>
        <Ticket params={params} />
      </Suspense>
    </div>
  );
}

/** Rendered on the server as an SVG data URI: no client code, nothing to tamper with in the page. */
async function qrDataUri(code: string): Promise<string> {
  const svg = await QRCode.toString(code, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 0,
    color: { dark: "#101010", light: "#F5F5F0" },
  });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

const statusCopy = { valid: "Valid", checked_in: "Used", void: "Void" } as const;

async function Ticket({ params }: { params: Params }) {
  await connection();
  const { id } = await params;
  const actor = await requireActorOrRedirect(`/tickets/${id}`);
  const ticket = await getTicketForUser(getDb(), actor, id).catch((error: unknown) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const { event } = ticket;
  const tz = event.timeZone;
  const qr = await qrDataUri(ticket.code);

  return (
    <div className="mx-auto max-w-md">
      <Link href="/tickets" className="label text-graphite-400 hover:text-offwhite">
        ← All tickets
      </Link>

      <article aria-labelledby="ticket-title" className="mt-6 overflow-hidden bg-offwhite text-obsidian">
        <div className="relative aspect-[16/9]">
          <Photo src={event.heroImageUrl} alt="" sizes="448px" fill priority credit={event.heroImageCredit} creditPosition="inside-top" />
          <div className="absolute inset-0 scrim-bottom" />
          <div className="absolute inset-x-0 bottom-0 p-5">
            <p className="label text-graphite-300">{ticket.kind === "experience" ? "Experience" : "Admission"}</p>
            <h1 id="ticket-title" className="mt-1 font-display text-3xl font-semibold leading-[0.95] tracking-tight text-offwhite">
              {event.title}
            </h1>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 p-5">
          <div className="col-span-2">
            <dt className="label text-graphite-500">Ticket</dt>
            <dd className="mt-1 font-display text-xl font-semibold tracking-tight">{ticket.itemName}</dd>
          </div>
          <div>
            <dt className="label text-graphite-500">{ticket.experienceStartsAt ? "Session" : "Dates"}</dt>
            <dd className="mt-1 text-sm">
              {ticket.experienceStartsAt
                ? `${formatDay(ticket.experienceStartsAt, tz)}, ${formatTime(ticket.experienceStartsAt, tz)}`
                : formatDateRange(event.startsAt, event.endsAt, tz)}
            </dd>
          </div>
          <div>
            <dt className="label text-graphite-500">Where</dt>
            <dd className="mt-1 text-sm">{ticket.experienceLocation ?? `${event.venueName}, ${event.city}`}</dd>
          </div>
          <div>
            <dt className="label text-graphite-500">Holder</dt>
            <dd className="mt-1 text-sm">{ticket.holderName}</dd>
          </div>
          <div>
            <dt className="label text-graphite-500">Status</dt>
            <dd className={`mt-1 text-sm font-medium ${ticket.status === "valid" ? "text-obsidian" : "text-graphite-500"}`}>
              {statusCopy[ticket.status]}
            </dd>
          </div>
        </dl>

        <div aria-hidden className="relative mx-5 border-t-2 border-dashed border-graphite-200">
          <span className="absolute -top-3 -left-8 size-6 rounded-full bg-obsidian" />
          <span className="absolute -top-3 -right-8 size-6 rounded-full bg-obsidian" />
        </div>

        <div className="p-5 pt-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- server-generated SVG data URI */}
          <img src={qr} alt={`QR code for ticket ${ticket.code}`} className="mx-auto aspect-square w-3/4 max-w-64" />
          <p className="tabular mt-5 font-mono text-lg tracking-[0.12em]">{ticket.code}</p>
          <p className="mt-3 text-xs text-graphite-500">
            Display only — entry scanning and validation are not part of this prototype.
          </p>
        </div>
      </article>

      <section aria-labelledby="companion" className="mt-6 border border-violet/40 p-5">
        <p id="companion" className="flex items-center gap-2 label text-violet-soft">
          <span aria-hidden className="size-1.5 bg-violet" /> Living ticket · coming soon
        </p>
        <p className="mt-3 text-sm text-graphite-300">
          Your schedule, nearby experiences and help on the day will appear here as the event approaches.
        </p>
        <Link href={`/events/${event.slug}`} className="mt-4 inline-block label text-offwhite hover:text-lime">
          Event programme →
        </Link>
      </section>
    </div>
  );
}
