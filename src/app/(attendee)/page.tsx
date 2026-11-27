import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { categoryLabels, formatDateRange, formatDay, formatPrice, formatTime } from "@/components/format";
import { Photo } from "@/components/media/photo";
import { ParallaxMedia } from "@/components/motion/parallax-media";
import { RevealTitle } from "@/components/motion/reveal-title";
import { AvailabilityTag } from "@/components/ui/availability-tag";
import { getDb } from "@/infrastructure/db/client";
import { getCatalogFacets, listPublishedEvents, listUpcomingExperiences } from "@/modules/events";
import { ConciergeEntry } from "./_components/concierge-entry";
import { EventIndex } from "./_components/event-index";
import { pickFeatured, titleLines, toIndexRow } from "./_lib/present";

export default function HomePage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}

async function HomeContent() {
  await connection();
  const db = getDb();
  const [events, experiences, facets] = await Promise.all([
    listPublishedEvents(db),
    listUpcomingExperiences(db, 10),
    getCatalogFacets(db),
  ]);
  const featured = pickFeatured(events);

  return (
    <>
      {featured ? (
        <section aria-labelledby="featured-title" className="relative flex min-h-[100svh] flex-col justify-end overflow-hidden">
          <ParallaxMedia>
            <Photo
              src={featured.heroImageUrl}
              alt=""
              sizes="100vw"
              priority
              fill
              creditPosition="none"
            />
          </ParallaxMedia>
          <div className="absolute inset-0 scrim-bottom" />

          <div className="container-edge relative pb-10 pt-32 md:pb-14">
            <p className="flex flex-wrap items-center gap-x-5 gap-y-2 label text-offwhite">
              <span className="bg-lime px-2 py-1 text-obsidian">Featured</span>
              <span>{categoryLabels[featured.category]?.replace(/s$/, "")}</span>
              <AvailabilityTag status={featured.availability} />
            </p>
            <RevealTitle
              lines={titleLines(featured.title)}
              className="mt-6 font-display text-display-xl font-semibold text-offwhite"
            />
            <div className="mt-8 grid gap-6 border-t border-offwhite/25 pt-6 md:grid-cols-12 md:items-end">
              <p className="max-w-xl text-lg text-offwhite/90 md:col-span-5 md:text-xl">{featured.summary}</p>
              <dl className="grid grid-cols-2 gap-4 md:col-span-4">
                <div>
                  <dt className="label text-graphite-300">When</dt>
                  <dd className="mt-1 text-offwhite">{formatDateRange(featured.startsAt, featured.endsAt, featured.timeZone)}</dd>
                </div>
                <div>
                  <dt className="label text-graphite-300">Where</dt>
                  <dd className="mt-1 text-offwhite">
                    {featured.venueName}, {featured.city}
                  </dd>
                </div>
              </dl>
              <div className="md:col-span-3 md:justify-self-end">
                <Link
                  href={`/events/${featured.slug}`}
                  className="group inline-flex w-full items-center justify-between gap-6 bg-lime px-5 py-4 font-medium text-obsidian transition-colors hover:bg-offwhite md:w-auto"
                >
                  Tickets
                  {featured.fromPriceMinor !== null && featured.currency && (
                    <span className="tabular text-sm">from {formatPrice(featured.fromPriceMinor, featured.currency)}</span>
                  )}
                  <span aria-hidden className="transition-transform group-hover:translate-x-1">→</span>
                </Link>
              </div>
            </div>
            {featured.heroImageCredit && <p className="mt-6 label text-[0.625rem] text-graphite-400">{featured.heroImageCredit}</p>}
          </div>
        </section>
      ) : (
        <section className="container-edge pb-16 pt-40">
          <h1 className="font-display text-display-xl font-semibold">The next generation of live experiences.</h1>
        </section>
      )}

      <Ticker items={events.map((e) => `${e.title} — ${formatDateRange(e.startsAt, e.endsAt, e.timeZone)} — ${e.city}`)} />

      <section aria-labelledby="upcoming" className="container-edge pt-24 md:pt-32">
        <div className="mb-10 flex items-end justify-between gap-6">
          <div>
            <p className="label text-graphite-400">Index · {events.length} upcoming</p>
            <h2 id="upcoming" className="mt-3 font-display text-display-lg font-semibold">What’s on</h2>
          </div>
          <Link href="/discover" className="label hidden text-graphite-300 hover:text-lime md:inline">
            Search and filter →
          </Link>
        </div>
        {events.length > 0 ? (
          <EventIndex rows={events.map(toIndexRow)} />
        ) : (
          <p className="border-t hairline py-10 text-graphite-300">No upcoming events yet. Check back soon.</p>
        )}
      </section>

      {experiences.length > 0 && (
        <section aria-labelledby="experiences" className="pt-28 md:pt-36">
          <div className="container-edge mb-10 grid gap-6 md:grid-cols-12 md:items-end">
            <div className="md:col-span-7">
              <p className="label text-graphite-400">Beyond the ticket</p>
              <h2 id="experiences" className="mt-3 font-display text-display-lg font-semibold">
                Small rooms,
                <br /> big moments.
              </h2>
            </div>
            <p className="text-graphite-300 md:col-span-5 md:text-lg">
              Sunset sets, chef’s tables, sunrise yoga. Bookable experiences with their own capacity — add them to your
              pass or book them on their own.
            </p>
          </div>
          <ul className="no-scrollbar container-edge flex snap-x snap-mandatory scroll-px-[clamp(1.25rem,4vw,3rem)] gap-4 overflow-x-auto pb-4 md:gap-6" aria-label="Experiences">
            {experiences.map((exp) => (
              <li key={exp.id} className="w-[78vw] max-w-[22rem] shrink-0 snap-start sm:w-[22rem]">
                <Link href={`/events/${exp.event.slug}#experience-${exp.slug}`} className="group block">
                  <Photo
                    src={exp.imageUrl}
                    alt=""
                    sizes="(min-width: 640px) 352px, 78vw"
                    className="aspect-[4/5]"
                    imageClassName="transition-transform duration-700 ease-out group-hover:scale-[1.04]"
                    credit={exp.imageCredit}
                  />
                  <div className="mt-4 flex items-start justify-between gap-4">
                    <div>
                      <p className="label text-graphite-400">
                        {formatDay(exp.startsAt, exp.event.timeZone)} · {formatTime(exp.startsAt, exp.event.timeZone)}
                      </p>
                      <h3 className="mt-2 font-display text-2xl font-semibold leading-tight tracking-tight group-hover:text-lime">
                        {exp.title}
                      </h3>
                      <p className="mt-1 text-sm text-graphite-300">
                        {exp.event.title} · {exp.event.city}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {exp.soldOut ? (
                        <span className="label text-graphite-400">Sold out</span>
                      ) : (
                        exp.priceMinor !== null &&
                        exp.currency && <span className="tabular text-sm">{formatPrice(exp.priceMinor, exp.currency)}</span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="browse" className="container-edge pt-28 md:pt-36">
        <p id="browse" className="label text-graphite-400">Browse by kind of night</p>
        <ul className="mt-6 border-t hairline">
          {facets.categories.map((c) => (
            <li key={c.value} className="border-b hairline">
              <Link
                href={`/discover?category=${c.value}`}
                className="group flex items-baseline justify-between gap-6 py-5 md:py-7"
              >
                <span className="font-display text-[clamp(2.5rem,7vw,6.5rem)] font-semibold leading-[0.9] tracking-[-0.04em] transition-colors group-hover:text-lime">
                  {categoryLabels[c.value]}
                </span>
                <span className="tabular label text-graphite-400 transition-transform group-hover:-translate-x-1">
                  {String(c.count).padStart(2, "0")} →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <ConciergeEntry />
    </>
  );
}

function Ticker({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  const sequence = [...items, ...items];
  return (
    <div className="overflow-hidden border-y hairline bg-obsidian py-4" aria-hidden>
      <div className="animate-marquee flex w-max gap-10 whitespace-nowrap">
        {sequence.map((item, i) => (
          <span key={i} className="flex items-center gap-10 label text-graphite-300">
            {item}
            <span className="text-lime">✦</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading events">
      <div className="min-h-[100svh] animate-pulse bg-graphite-900" />
      <div className="container-edge space-y-4 py-24">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 border-b hairline" />
        ))}
      </div>
    </div>
  );
}
