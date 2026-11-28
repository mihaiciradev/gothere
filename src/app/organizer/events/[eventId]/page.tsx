import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatDateRange, formatDay, formatPrice, formatTime } from "@/components/format";
import { getDb } from "@/infrastructure/db/client";
import { getEventInsights, listRecommendations } from "@/modules/analytics";
import { isAppError } from "@/shared/errors";
import { organizerContext } from "../../_lib/context";
import { Badge, Meter, NoOrganization, PageHeader } from "../../_components/ui";

type Params = Promise<{ eventId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function OrganizerEventPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div aria-busy className="h-96 bg-graphite-100" />}>
      <EventDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function EventDetail({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  await connection();
  const { eventId } = await params;
  const ctx = await organizerContext(searchParams, `/organizer/events/${eventId}`);
  if (!ctx) return <NoOrganization />;
  const db = getDb();
  let insights;
  try {
    insights = await getEventInsights(db, ctx.actor, eventId, { organizationId: ctx.organization.id });
  } catch (error) {
    if (isAppError(error) && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) notFound();
    throw error;
  }
  const recommendations = (await listRecommendations(db, ctx.actor, ctx.organization.id)).filter((r) => r.eventId === eventId && r.status !== "dismissed");
  const { event } = insights;
  const tz = event.timeZone;
  const experienceOf = new Map(insights.experiences.map((x) => [x.id, x]));
  const recommendedFor = new Map(recommendations.map((r) => [r.sourceInventoryItemId, r]));

  return (
    <div className="space-y-10">
      <nav aria-label="Breadcrumb" className="text-sm text-graphite-500">
        <Link href={ctx.href("/organizer")} className="hover:text-obsidian">Overview</Link>
        <span aria-hidden className="px-2">/</span>
        <span>{event.title}</span>
      </nav>
      <PageHeader
        eyebrow={`${event.venueName}, ${event.city}`}
        title={event.title}
        actions={
          event.status === "published" && (
            <Link href={`/events/${event.slug}`} className="text-sm text-graphite-500 hover:text-obsidian">
              Public page ↗
            </Link>
          )
        }
      >
        {formatDateRange(event.startsAt, event.endsAt, tz)} · times in {tz}
      </PageHeader>

      <section aria-labelledby="inventory-title">
        <h2 id="inventory-title" className="font-display text-xl font-semibold tracking-tight">
          Inventory, sales and unmet demand
        </h2>
        <p className="mt-1 text-sm text-graphite-500">“Interested” counts distinct people who joined a waitlist or looked at a sold-out item.</p>
        <div className="mt-4 overflow-x-auto border border-border bg-raised" tabIndex={0} role="region" aria-label="Inventory, sales and demand table">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {["Item", "Status", "Sold / capacity", "Interested", "Live", "Seeded"].map((h, i) => (
                  <th key={h} scope="col" className={`px-4 py-3 label font-normal text-graphite-500 ${i >= 4 ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {insights.items.map((item) => {
                const experience = item.experienceId ? experienceOf.get(item.experienceId) : undefined;
                const rec = recommendedFor.get(item.id);
                return (
                  <tr key={item.id} className="border-b border-border align-top last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium">{item.name}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-graphite-500">
                        <span>{item.kind === "admission" ? "Admission" : "Experience"}</span>
                        <span className="tabular">{formatPrice(item.priceMinor, item.currency)}</span>
                        {experience && (
                          <span>
                            {formatDay(experience.startsAt, tz)} {formatTime(experience.startsAt, tz)}
                          </span>
                        )}
                        {experience?.origin === "ai_recommendation" && <Badge tone="intel">From recommendation</Badge>}
                        {experience && experience.status !== "published" && <Badge>{experience.status}</Badge>}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={item.available === 0 && item.capacity > 0 ? "dark" : item.status === "on_sale" ? "success" : "neutral"}>
                        {item.available === 0 && item.capacity > 0 ? "sold out" : item.status.replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className="tabular">
                        {item.sold.toLocaleString("en-GB")} / {item.capacity.toLocaleString("en-GB")}
                      </span>
                      <div className="mt-1.5">
                        <Meter value={item.sold} max={item.capacity} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {item.demand.uniqueInterested > 0 ? (
                        <>
                          <p className="tabular font-medium">{item.demand.uniqueInterested}</p>
                          <p className="text-xs text-graphite-500">
                            {item.demand.waitlist} waitlist · {item.demand.viewers} viewers
                          </p>
                          {rec && (
                            <Link href={ctx.href("/organizer/intelligence")} className="mt-1 inline-block text-xs text-violet-strong hover:underline">
                              {rec.status === "open" ? "Opportunity →" : `Recommendation ${rec.status} →`}
                            </Link>
                          )}
                        </>
                      ) : (
                        <span className="text-graphite-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="tabular">{formatPrice(item.live.grossMinor, item.currency)}</p>
                      <p className="text-xs text-graphite-500">{item.live.tickets} tickets</p>
                    </td>
                    <td className="px-4 py-3 text-right text-graphite-500">
                      <p className="tabular">{formatPrice(item.seed.grossMinor, item.currency)}</p>
                      <p className="text-xs">{item.seed.tickets} tickets</p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
