import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { categoryLabels, formatDateRange, formatDay, formatPrice, formatTime } from "@/components/format";
import { Photo } from "@/components/media/photo";
import { ParallaxMedia } from "@/components/motion/parallax-media";
import { RevealTitle } from "@/components/motion/reveal-title";
import { AvailabilityTag } from "@/components/ui/availability-tag";
import { getDb } from "@/infrastructure/db/client";
import { type CatalogItem, type PublishedEvent, getPublishedEvent } from "@/modules/events";
import { isAppError } from "@/shared/errors";
import { titleLines } from "../../_lib/present";
import { type PanelGroup, type PanelItem, TicketPanel } from "./ticket-panel";

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function EventPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <Suspense fallback={<EventSkeleton />}>
      <EventContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

/** `?select=id:qty,id:qty` (from the sign-in round trip), kept only where it is still purchasable. */
function parseSelection(raw: string | string[] | undefined, items: PanelItem[]): Record<string, number> {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || value.length > 1000) return {};
  const selection: Record<string, number> = {};
  for (const part of value.split(",")) {
    const [id, qty] = part.split(":");
    const quantity = Number(qty);
    const item = items.find((i) => i.id === id);
    if (!item || !item.onSale || item.soldOut || !Number.isInteger(quantity) || quantity < 1) continue;
    selection[item.id] = Math.min(quantity, item.maxPerOrder, item.available);
  }
  return selection;
}

async function loadEvent(slug: string): Promise<PublishedEvent> {
  try {
    return await getPublishedEvent(getDb(), slug);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

function toPanelItem(item: CatalogItem, detail: string | null = null): PanelItem {
  return {
    id: item.id,
    name: item.name,
    description: item.kind === "admission" ? item.description : null,
    detail,
    priceLabel: formatPrice(item.priceMinor, item.currency),
    priceMinor: item.priceMinor,
    currency: item.currency,
    maxPerOrder: item.maxPerOrder,
    available: item.available,
    onSale: item.onSale,
    soldOut: item.soldOut,
  };
}

async function EventContent({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  await connection();
  const { slug } = await params;
  const event = await loadEvent(slug);
  const tz = event.timeZone;
  const groups: PanelGroup[] = [
    { label: "Passes", items: event.admissions.map((a) => toPanelItem(a)) },
    {
      label: "Experiences",
      items: event.experiences.flatMap((exp) =>
        exp.items.map((item) => toPanelItem(item, `${formatDay(exp.startsAt, tz)} · ${formatTime(exp.startsAt, tz)}`)),
      ),
    },
  ];
  const initialSelection = parseSelection((await searchParams).select, groups.flatMap((g) => g.items));

  const days = new Map<string, PublishedEvent["experiences"]>();
  for (const exp of event.experiences) {
    const key = formatDay(exp.startsAt, tz);
    days.set(key, [...(days.get(key) ?? []), exp]);
  }

  return (
    <article>
      <header className="relative flex min-h-[88svh] flex-col justify-end overflow-hidden">
        <ParallaxMedia>
          <Photo src={event.heroImageUrl} alt="" sizes="100vw" priority fill creditPosition="none" />
        </ParallaxMedia>
        <div className="absolute inset-0 scrim-bottom" />
        <div className="container-edge relative pb-10 pt-32">
          <nav aria-label="Breadcrumb" className="label text-graphite-300">
            <Link href="/discover" className="hover:text-offwhite">Discover</Link>
            <span aria-hidden className="px-2">/</span>
            <span>{categoryLabels[event.category]}</span>
          </nav>
          <RevealTitle lines={titleLines(event.title)} className="mt-5 font-display text-display-xl font-semibold text-offwhite" />
          <dl className="mt-8 grid grid-cols-2 gap-6 border-t border-offwhite/25 pt-6 md:grid-cols-4">
            <div>
              <dt className="label text-graphite-300">Dates</dt>
              <dd className="mt-1 text-offwhite">{formatDateRange(event.startsAt, event.endsAt, tz)}</dd>
            </div>
            <div>
              <dt className="label text-graphite-300">Doors</dt>
              <dd className="mt-1 text-offwhite">
                {formatDay(event.startsAt, tz)}, {formatTime(event.startsAt, tz)}
              </dd>
            </div>
            <div>
              <dt className="label text-graphite-300">Venue</dt>
              <dd className="mt-1 text-offwhite">
                {event.venueName}, {event.city}
              </dd>
            </div>
            <div>
              <dt className="label text-graphite-300">Tickets</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-3 text-offwhite">
                {event.fromPriceMinor !== null && event.currency && (
                  <span className="tabular">from {formatPrice(event.fromPriceMinor, event.currency)}</span>
                )}
                <AvailabilityTag status={event.availability} />
              </dd>
            </div>
          </dl>
          {event.heroImageCredit && <p className="mt-6 label text-[0.625rem] text-graphite-400">{event.heroImageCredit}</p>}
        </div>
      </header>

      <div className="container-edge grid gap-12 pt-12 md:grid-cols-12 md:gap-10 md:pt-20">
        <aside className="md:col-span-5 md:col-start-8 md:row-span-3 md:row-start-1">
          <div className="md:sticky md:top-24 md:max-h-[calc(100svh-7rem)] md:overflow-y-auto md:overscroll-contain">
            <TicketPanel
              key={JSON.stringify(initialSelection)}
              eventId={event.id}
              eventSlug={event.slug}
              groups={groups}
              initialSelection={initialSelection}
            />
          </div>
        </aside>

        <section aria-labelledby="about" className="md:col-span-7 md:row-start-1">
          <h2 id="about" className="label text-graphite-400">About</h2>
          <p className="mt-4 font-display text-[clamp(1.5rem,2.6vw,2.25rem)] font-medium leading-[1.15] tracking-[-0.02em]">
            {event.summary}
          </p>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-graphite-300">{event.description}</p>
        </section>

        {event.experiences.length > 0 && (
          <section aria-labelledby="programme" className="md:col-span-7 md:row-start-2">
            <h2 id="programme" className="label text-graphite-400">Programme · bookable experiences</h2>
            <div className="mt-6 space-y-10">
              {[...days.entries()].map(([day, list]) => (
                <div key={day}>
                  <p className="font-display text-xl font-semibold">{day}</p>
                  <ul className="mt-4 border-t hairline">
                    {list.map((exp) => {
                      const item = exp.items[0];
                      return (
                        <li key={exp.id} id={`experience-${exp.slug}`} className="scroll-mt-24 border-b hairline py-6">
                          <div className="grid gap-5 sm:grid-cols-[1fr_11rem]">
                            <div>
                              <p className="tabular label text-graphite-400">
                                {formatTime(exp.startsAt, tz)}–{formatTime(exp.endsAt, tz)}
                                {exp.location ? ` · ${exp.location}` : ""}
                              </p>
                              <h3 className="mt-2 font-display text-2xl font-semibold leading-tight tracking-tight md:text-3xl">{exp.title}</h3>
                              <p className="mt-2 text-graphite-300">{exp.description}</p>
                              {item && (
                                <p className="mt-4 flex flex-wrap items-center gap-4 text-sm">
                                  <span className="tabular">{formatPrice(item.priceMinor, item.currency)}</span>
                                  <AvailabilityTag status={item.soldOut ? "sold_out" : item.available <= 10 ? "limited" : "available"} />
                                  {!item.soldOut && (
                                    <a href="#tickets" className="label text-graphite-300 hover:text-lime">
                                      Add in tickets ↑
                                    </a>
                                  )}
                                </p>
                              )}
                            </div>
                            <Photo
                              src={exp.imageUrl}
                              alt=""
                              sizes="(min-width: 640px) 176px, 100vw"
                              className="aspect-[4/3] sm:aspect-[4/5]"
                              credit={exp.imageCredit}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        <section aria-labelledby="venue" className="md:col-span-7 md:row-start-3">
          <h2 id="venue" className="label text-graphite-400">Venue</h2>
          <div className="mt-4 border-t hairline pt-6">
            <p className="font-display text-3xl font-semibold tracking-tight">{event.venueName}</p>
            <p className="mt-1 text-graphite-300">
              {event.city}, {event.countryCode === "RO" ? "Romania" : event.countryCode}
            </p>
            <p className="mt-4 text-sm text-graphite-400">All times are local ({tz.replace("_", " ")}).</p>
          </div>
        </section>
      </div>
    </article>
  );
}

function EventSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading event">
      <div className="min-h-[88svh] animate-pulse bg-graphite-900" />
      <div className="container-edge grid gap-10 pt-16 md:grid-cols-12">
        <div className="h-64 bg-graphite-900 md:col-span-7" />
        <div className="h-96 bg-graphite-900 md:col-span-5" />
      </div>
    </div>
  );
}
