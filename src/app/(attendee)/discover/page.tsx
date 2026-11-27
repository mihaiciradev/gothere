import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { categoryLabels, formatDateRange, formatMonthLabel, formatPrice } from "@/components/format";
import { Photo } from "@/components/media/photo";
import { AvailabilityTag } from "@/components/ui/availability-tag";
import { getDb } from "@/infrastructure/db/client";
import { type CatalogFilters, catalogFiltersSchema, getCatalogFacets, listPublishedEvents } from "@/modules/events";

export const metadata: Metadata = { title: "Discover" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function DiscoverPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="container-edge pt-28 md:pt-36">
      <header className="grid gap-8 border-b hairline pb-10 md:grid-cols-12 md:items-end">
        <div className="md:col-span-6">
          <p className="label text-graphite-400">Discover</p>
          <h1 className="mt-3 font-display text-display-lg font-semibold">Find your next night out.</h1>
        </div>
        <Suspense fallback={<div className="h-14 md:col-span-6" />}>
          <SearchForm searchParams={searchParams} />
        </Suspense>
      </header>
      <Suspense fallback={<ResultsSkeleton />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function readFilters(searchParams: SearchParams): Promise<{ filters: CatalogFilters; invalid: boolean }> {
  const raw = await searchParams;
  const candidate = Object.fromEntries(
    (["q", "category", "city", "month"] as const).map((k) => [k, first(raw[k])?.trim() || undefined]).filter(([, v]) => v),
  );
  const parsed = catalogFiltersSchema.safeParse(candidate);
  return parsed.success ? { filters: parsed.data, invalid: false } : { filters: {}, invalid: true };
}

function hrefWith(filters: CatalogFilters, change: Partial<CatalogFilters>): string {
  const next = { ...filters, ...change };
  const params = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]);
  const query = params.toString();
  return query ? `/discover?${query}` : "/discover";
}

async function SearchForm({ searchParams }: { searchParams: SearchParams }) {
  const { filters } = await readFilters(searchParams);
  return (
    <form action="/discover" method="get" role="search" className="md:col-span-6">
      {filters.category && <input type="hidden" name="category" value={filters.category} />}
      {filters.city && <input type="hidden" name="city" value={filters.city} />}
      {filters.month && <input type="hidden" name="month" value={filters.month} />}
      <label htmlFor="q" className="label text-graphite-400">
        Search events, cities and experiences
      </label>
      <div className="mt-2 flex items-center gap-3 border-b border-graphite-600 focus-within:border-lime">
        <input
          id="q"
          name="q"
          defaultValue={filters.q ?? ""}
          maxLength={80}
          placeholder="Try “sunset”, “Sibiu” or “techno”"
          className="min-w-0 flex-1 bg-transparent py-3 text-xl text-offwhite placeholder:text-graphite-400 focus:outline-none md:text-2xl"
        />
        <button type="submit" className="label px-1 py-3 text-offwhite hover:text-lime">
          Search →
        </button>
      </div>
      <p className="mt-3 flex items-center gap-2 text-xs text-graphite-400">
        <span aria-hidden className="size-1.5 bg-violet" />
        Keyword search today. A conversational concierge arrives in the next release.
      </p>
    </form>
  );
}

function FilterGroup({
  label,
  options,
  active,
  build,
}: {
  label: string;
  options: { value: string; label: string; count: number }[];
  active?: string;
  build: (value: string | undefined) => string;
}) {
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-3">
      <span className="label w-20 shrink-0 text-graphite-400">{label}</span>
      <Link href={build(undefined)} aria-current={!active ? "true" : undefined} className={`label ${!active ? "text-lime" : "text-graphite-300 hover:text-offwhite"}`}>
        All
      </Link>
      {options.map((o) => {
        const selected = active?.toLowerCase() === o.value.toLowerCase();
        return (
          <Link
            key={o.value}
            href={build(selected ? undefined : o.value)}
            aria-current={selected ? "true" : undefined}
            className={`label ${selected ? "text-lime" : "text-graphite-300 hover:text-offwhite"}`}
          >
            {o.label} <span className="text-graphite-400">{o.count}</span>
          </Link>
        );
      })}
    </div>
  );
}

async function Results({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const { filters, invalid } = await readFilters(searchParams);
  const db = getDb();
  const [events, facets] = await Promise.all([listPublishedEvents(db, filters), getCatalogFacets(db)]);
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <>
      <nav aria-label="Filters" className="space-y-4 border-b hairline py-8">
        <FilterGroup
          label="Kind"
          active={filters.category}
          options={facets.categories.map((c) => ({ value: c.value, label: categoryLabels[c.value] ?? c.value, count: c.count }))}
          build={(v) => hrefWith(filters, { category: v as CatalogFilters["category"] })}
        />
        <FilterGroup
          label="City"
          active={filters.city}
          options={facets.cities.map((c) => ({ value: c.value, label: c.value, count: c.count }))}
          build={(v) => hrefWith(filters, { city: v })}
        />
        <FilterGroup
          label="Month"
          active={filters.month}
          options={facets.months.map((m) => ({ value: m.value, label: formatMonthLabel(m.value), count: m.count }))}
          build={(v) => hrefWith(filters, { month: v })}
        />
      </nav>

      <div className="flex items-baseline justify-between py-6">
        <p className="label text-graphite-400" aria-live="polite">
          {events.length} {events.length === 1 ? "event" : "events"}
          {filters.q ? ` matching “${filters.q}”` : ""}
        </p>
        {hasFilters && (
          <Link href="/discover" className="label text-graphite-300 hover:text-lime">
            Clear filters
          </Link>
        )}
      </div>

      {invalid && (
        <p role="status" className="mb-6 border-l-2 border-warning pl-4 text-sm text-graphite-300">
          Some filters weren’t recognised, so all events are shown.
        </p>
      )}

      {events.length === 0 ? (
        <div className="border-t hairline py-20">
          <p className="font-display text-4xl font-semibold tracking-tight">Nothing matches that yet.</p>
          <p className="mt-4 max-w-md text-graphite-300">
            Try a city, a kind of night or an experience — “jazz”, “Constanța”, “yoga”.
          </p>
          <Link href="/discover" className="mt-8 inline-block label text-lime">
            See all events →
          </Link>
        </div>
      ) : (
        <ol className="space-y-px">
          {events.map((event, i) => (
            <li key={event.id} className="border-t hairline">
              <Link href={`/events/${event.slug}`} className="group grid gap-6 py-8 md:grid-cols-12 md:gap-10 md:py-10">
                <Photo
                  src={event.heroImageUrl}
                  alt=""
                  sizes="(min-width: 768px) 40vw, 100vw"
                  priority={i < 2}
                  className="aspect-[16/10] md:col-span-5"
                  imageClassName="transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                  credit={event.heroImageCredit}
                />
                <div className="flex flex-col md:col-span-7">
                  <p className="flex flex-wrap items-center gap-x-4 gap-y-1 label text-graphite-400">
                    <span>{categoryLabels[event.category]?.replace(/s$/, "")}</span>
                    <span>{formatDateRange(event.startsAt, event.endsAt, event.timeZone)}</span>
                    <span>{event.city}</span>
                  </p>
                  <h2 className="mt-4 font-display text-[clamp(2rem,4vw,3.75rem)] font-semibold leading-[0.95] tracking-[-0.035em] transition-colors group-hover:text-lime">
                    {event.title}
                  </h2>
                  <p className="mt-4 max-w-xl text-graphite-300 md:text-lg">{event.summary}</p>
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-4 pt-8">
                    <AvailabilityTag status={event.availability} />
                    <span className="flex items-center gap-4 text-sm">
                      {event.experienceCount > 0 && (
                        <span className="text-graphite-300">
                          {event.experienceCount} experience{event.experienceCount > 1 ? "s" : ""}
                        </span>
                      )}
                      {event.fromPriceMinor !== null && event.currency && (
                        <span className="tabular text-offwhite">from {formatPrice(event.fromPriceMinor, event.currency)}</span>
                      )}
                      <span aria-hidden className="transition-transform group-hover:translate-x-1">→</span>
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function ResultsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading events" className="space-y-6 py-10">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="grid gap-6 md:grid-cols-12">
          <div className="aspect-[16/10] animate-pulse bg-graphite-900 md:col-span-5" />
          <div className="space-y-4 md:col-span-7">
            <div className="h-4 w-48 bg-graphite-900" />
            <div className="h-12 w-3/4 bg-graphite-900" />
          </div>
        </div>
      ))}
    </div>
  );
}
