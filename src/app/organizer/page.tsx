import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { listActionRequests } from "@/actions";
import { formatDateRange, formatPrice } from "@/components/format";
import { getDb } from "@/infrastructure/db/client";
import { getOrganizationSales, listRecommendations } from "@/modules/analytics";
import { organizerContext } from "./_lib/context";
import { Badge, Empty, Meter, NoOrganization, PageHeader, Stat } from "./_components/ui";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function OrganizerOverview({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <Overview searchParams={searchParams} />
    </Suspense>
  );
}

async function Overview({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const ctx = await organizerContext(searchParams, "/organizer");
  if (!ctx) return <NoOrganization />;
  const db = getDb();
  const [sales, recommendations, requests] = await Promise.all([
    getOrganizationSales(db, ctx.actor, ctx.organization.id),
    listRecommendations(db, ctx.actor, ctx.organization.id),
    listActionRequests(db, ctx.actor, ctx.organization.id),
  ]);
  const currency = sales.events.find((e) => e.currency)?.currency ?? "EUR";
  const open = recommendations.filter((r) => r.status === "open");
  const pending = requests.filter((r) => r.status === "pending_approval");
  const top = open[0];

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow={`${ctx.organization.name} · ${ctx.organization.role}`}
        title="Overview"
        actions={
          ctx.memberships.length > 1 && (
            <nav aria-label="Organization" className="flex gap-2">
              {ctx.memberships.map((m) => (
                <Link
                  key={m.id}
                  href={`/organizer?org=${m.slug}`}
                  aria-current={m.id === ctx.organization.id ? "true" : undefined}
                  className={`border px-3 py-1.5 text-sm ${m.id === ctx.organization.id ? "border-obsidian bg-obsidian text-offwhite" : "border-border bg-raised hover:border-obsidian"}`}
                >
                  {m.name}
                </Link>
              ))}
            </nav>
          )
        }
      >
        Sales from live checkouts and seeded demonstration history are always shown separately.
      </PageHeader>

      <section aria-label="Key figures" className="grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Live revenue" value={formatPrice(sales.totals.live.grossMinor, currency)} hint={`${sales.totals.live.tickets} tickets · ${sales.totals.live.orders} orders`} />
        <Stat label="Seeded history" value={formatPrice(sales.totals.seed.grossMinor, currency)} hint={`${sales.totals.seed.tickets} tickets · demonstration data`} />
        <Stat label="Open opportunities" value={open.length} hint={open.length ? "From unmet demand" : "Run an analysis in Intelligence"} tone="intel" />
        <Stat label="Waiting for approval" value={pending.length} hint={pending.length ? "Actions held for a human" : "Nothing waiting"} />
      </section>

      {top && (
        <Link
          href={ctx.href("/organizer/intelligence")}
          className="group block border border-violet-strong/30 bg-raised p-5 transition-colors hover:border-violet-strong md:p-6"
        >
          <p className="flex items-center gap-2 label text-violet-strong">
            <span aria-hidden className="size-1.5 bg-violet-strong" />
            Opportunity
          </p>
          <p className="mt-3 max-w-3xl font-display text-xl font-semibold tracking-tight">
            {top.evidence.uniqueInterested} people want {top.evidence.itemName}, which is sold out. A second session could gross up to{" "}
            {formatPrice(top.proposal.maxGrossMinor, top.proposal.currency)}.
          </p>
          <p className="mt-2 text-sm text-graphite-500 group-hover:text-obsidian">Review the evidence →</p>
        </Link>
      )}

      <section aria-labelledby="events-title">
        <h2 id="events-title" className="font-display text-xl font-semibold tracking-tight">
          Events
        </h2>
        {sales.events.length === 0 ? (
          <div className="mt-4">
            <Empty title="No events yet." />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto border border-border bg-raised">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th scope="col" className="px-4 py-3 label font-normal text-graphite-500">Event</th>
                  <th scope="col" className="px-4 py-3 label font-normal text-graphite-500">Status</th>
                  <th scope="col" className="px-4 py-3 label font-normal text-graphite-500">Admission sold</th>
                  <th scope="col" className="px-4 py-3 text-right label font-normal text-graphite-500">Live</th>
                  <th scope="col" className="px-4 py-3 text-right label font-normal text-graphite-500">Seeded</th>
                </tr>
              </thead>
              <tbody>
                {sales.events.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0 hover:bg-offwhite">
                    <td className="px-4 py-3">
                      <Link href={ctx.href(`/organizer/events/${e.id}`)} className="font-medium hover:text-violet-strong">
                        {e.title}
                      </Link>
                      <p className="text-xs text-graphite-500">
                        {formatDateRange(e.startsAt, e.endsAt, e.timeZone)} · {e.city}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={e.status === "published" ? "success" : "neutral"}>{e.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-4">
                        <span className="tabular w-24">
                          {e.admissionSold.toLocaleString("en-GB")} / {e.admissionCapacity.toLocaleString("en-GB")}
                        </span>
                        <Meter value={e.admissionSold} max={e.admissionCapacity} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular">{formatPrice(e.live.grossMinor, e.currency ?? currency)}</td>
                    <td className="px-4 py-3 text-right tabular text-graphite-500">{formatPrice(e.seed.grossMinor, e.currency ?? currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div aria-busy className="space-y-10">
      <div className="h-24 border-b border-border" />
      <div className="grid h-32 gap-px bg-graphite-100 sm:grid-cols-4" />
      <div className="h-64 bg-graphite-100" />
    </div>
  );
}
