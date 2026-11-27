import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { type ActionRequestView, listActionRequests } from "@/actions";
import { aiStatus } from "@/composition/ai";
import { formatDay, formatPrice, formatTime } from "@/components/format";
import { getDb } from "@/infrastructure/db/client";
import { type Recommendation, type RecommendationOutcome, listRecommendations, recommendationOutcomes, topUnmatchedSearches } from "@/modules/analytics";
import { getEventsByIds } from "@/modules/events";
import { organizerContext } from "../_lib/context";
import { RecommendationActions, RunAnalysisButton } from "../_components/intelligence-actions";
import { Badge, Empty, NoOrganization, PageHeader } from "../_components/ui";

export const metadata: Metadata = { title: "Intelligence" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function IntelligencePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div aria-busy className="h-96 bg-graphite-100" />}>
      <Intelligence searchParams={searchParams} />
    </Suspense>
  );
}

async function Intelligence({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const ctx = await organizerContext(searchParams, "/organizer/intelligence");
  if (!ctx) return <NoOrganization />;
  const db = getDb();
  const recommendations = (await listRecommendations(db, ctx.actor, ctx.organization.id)).filter((r) => r.status !== "dismissed");
  const [events, outcomes, searches, requests] = await Promise.all([
    getEventsByIds(db, [...new Set(recommendations.map((r) => r.eventId))]),
    recommendationOutcomes(db, recommendations.flatMap((r) => (r.experienceId ? [r.experienceId] : []))),
    topUnmatchedSearches(db, 6),
    listActionRequests(db, ctx.actor, ctx.organization.id),
  ]);
  const publicationFor = (experienceId: string | null) =>
    experienceId ? requests.find((r) => r.actionId === "experience.publish" && (r.params as { experienceId?: string }).experienceId === experienceId) : undefined;
  const eventOf = new Map(events.map((e) => [e.id, e]));
  const ai = aiStatus();

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Unmet demand intelligence"
        title="What people wanted and couldn’t buy"
        actions={ctx.can("recommendation.read") && <RunAnalysisButton organizationId={ctx.organization.id} />}
      >
        Figures are computed from waitlists, sold-out views and sales in the database. AI may write the brief, never the
        numbers. {ai.enabled ? `AI briefs: ${ai.model}.` : "AI is not configured here, so briefs are written by rules."}
      </PageHeader>

      {recommendations.length === 0 ? (
        <Empty title="No opportunities yet.">Run the analysis to check sold-out sessions for enough unmet demand to justify another one.</Empty>
      ) : (
        <ol className="space-y-6">
          {recommendations.map((rec) => (
            <li key={rec.id}>
              <RecommendationCard
                rec={rec}
                event={eventOf.get(rec.eventId)}
                outcome={rec.experienceId ? outcomes.get(rec.experienceId) : undefined}
                publication={publicationFor(rec.experienceId)}
                organizationId={ctx.organization.id}
                canWrite={ctx.can("experience.write")}
                approvalsHref={ctx.href("/organizer/approvals")}
                eventHref={ctx.href(`/organizer/events/${rec.eventId}`)}
              />
            </li>
          ))}
        </ol>
      )}

      <section aria-labelledby="searches-title" className="border-t border-border pt-8">
        <h2 id="searches-title" className="font-display text-xl font-semibold tracking-tight">
          Searches that found nothing
        </h2>
        <p className="mt-1 text-sm text-graphite-500">Across GoThere, last 90 days, distinct people. Searches are not tied to any organizer.</p>
        {searches.length === 0 ? (
          <p className="mt-4 text-sm text-graphite-500">None recorded.</p>
        ) : (
          <ul className="mt-4 grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {searches.map((s) => (
              <li key={s.query} className="flex items-baseline justify-between gap-4 bg-raised px-4 py-3">
                <span className="truncate">“{s.query}”</span>
                <span className="tabular text-sm text-graphite-500">{s.people} people</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const initiatorCopy = { ai_agent: "the AI agent", automation: "rules automation", user: "a person" } as const;
const statusTone = { open: "intel", drafted: "warning", published: "success", dismissed: "neutral" } as const;
const statusCopy = { open: "Open", drafted: "Draft awaiting approval", published: "Published", dismissed: "Dismissed" } as const;

function RecommendationCard({
  rec,
  event,
  outcome,
  publication,
  organizationId,
  canWrite,
  approvalsHref,
  eventHref,
}: {
  rec: Recommendation;
  event?: { title: string; timeZone: string };
  outcome?: RecommendationOutcome;
  publication?: ActionRequestView;
  organizationId: string;
  canWrite: boolean;
  approvalsHref: string;
  eventHref: string;
}) {
  const { evidence: e, proposal: p, assumptions: a } = rec;
  const tz = event?.timeZone ?? "UTC";
  const startsAt = new Date(p.startsAt);
  return (
    <article className="border border-border bg-raised">
      <header className="flex flex-col gap-3 border-b border-border p-5 md:flex-row md:items-start md:justify-between md:p-6">
        <div>
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone[rec.status]}>{statusCopy[rec.status]}</Badge>
            <Badge>Second session</Badge>
            <Link href={eventHref} className="label text-graphite-500 hover:text-obsidian">
              {event?.title ?? "Event"}
            </Link>
          </p>
          <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight">{p.title}</h2>
        </div>
        <div className="md:text-right">
          <p className="label text-graphite-500">Maximum gross, if every place sells</p>
          <p className="mt-1 font-display text-3xl font-semibold tabular">{formatPrice(p.maxGrossMinor, p.currency)}</p>
          <p className="text-xs text-graphite-500">Estimate, not revenue</p>
        </div>
      </header>

      <div className="grid gap-px bg-border md:grid-cols-3">
        <section aria-label="Evidence" className="bg-raised p-5 md:p-6">
          <p className="label text-graphite-500">Evidence</p>
          <dl className="mt-3 space-y-2 text-sm">
            <Row term={`${e.itemName} sold`} value={`${e.sold} / ${e.capacity}`} />
            <Row term="Unique interested" value={String(e.uniqueInterested)} strong />
            <Row term="Joined the waitlist" value={String(e.waitlistRequests)} />
            <Row term="Viewed while sold out" value={String(e.soldOutViewers)} />
            <Row term="Interest ÷ proposed places" value={`${e.interestToCapacityRatio}×`} />
            <Row term="Signals: live / seeded" value={`${e.liveSignals} / ${e.seedSignals}`} />
          </dl>
        </section>
        <section aria-label="Proposed action" className="bg-raised p-5 md:p-6">
          <p className="label text-graphite-500">Proposed action</p>
          <dl className="mt-3 space-y-2 text-sm">
            <Row term="When" value={`${formatDay(startsAt, tz)}, ${formatTime(startsAt, tz)}`} />
            <Row term="Places" value={String(p.capacity)} strong />
            <Row term="Price" value={formatPrice(p.priceMinor, p.currency)} strong />
            <Row term="Original price" value={formatPrice(e.priceMinor, e.currency)} />
            <Row term="Location" value={p.location ?? "As original"} />
          </dl>
          <p className="mt-3 text-xs text-graphite-500">{a.timingRule}</p>
        </section>
        <section aria-label="Revenue assumptions" className="bg-raised p-5 md:p-6">
          <p className="label text-graphite-500">Revenue assumptions</p>
          <table className="mt-3 w-full text-sm">
            <thead className="sr-only">
              <tr>
                <th>Conversion</th>
                <th>Tickets</th>
                <th>Gross</th>
              </tr>
            </thead>
            <tbody>
              {a.scenarios.map((s) => (
                <tr key={s.label} className="border-b border-border last:border-0">
                  <td className="py-1.5 text-graphite-500">{s.conversionPercent}% convert</td>
                  <td className="py-1.5 text-right tabular">{s.tickets} tickets</td>
                  <td className="py-1.5 text-right tabular font-medium">{formatPrice(s.grossMinor, p.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-graphite-500">{a.priceRule}</p>
        </section>
      </div>

      <div className="grid gap-6 border-t border-border p-5 md:grid-cols-2 md:p-6">
        <div>
          <p className="flex items-center gap-2 label text-graphite-500">
            Brief
            <Badge tone={rec.narrativeSource === "ai" ? "intel" : "neutral"}>
              {rec.narrativeSource === "ai" ? `AI · ${rec.narrativeModel} · numbers verified` : "Rules"}
            </Badge>
          </p>
          <p className="mt-2 text-sm leading-relaxed">{rec.narrative}</p>
        </div>
        <div>
          <p className="label text-graphite-500">Risks and limitations</p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-graphite-500">
            {rec.risks.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      </div>

      <footer className="border-t border-border p-5 md:p-6">
        {rec.status === "open" && <RecommendationActions organizationId={organizationId} recommendationId={rec.id} canWrite={canWrite} approvalsHref={approvalsHref} />}
        {rec.status === "drafted" && (
          <div className="border-l-2 border-violet-strong pl-4 text-sm">
            <p className="label text-violet-strong">
              {publication ? `Prepared by ${initiatorCopy[publication.initiator]} for ${publication.requestedBy.name}` : "Draft created"}
            </p>
            <p className="mt-1">
              {publication?.status === "pending_approval"
                ? "A private draft exists. Its publication is waiting for a person to approve it; nothing is on sale yet."
                : publication?.status === "failed" || publication?.status === "expired" || publication?.status === "rejected"
                  ? `The publication request was ${publication.status}. The draft stays private.`
                  : "A private draft exists. Nothing is on sale yet."}
            </p>
            <Link href={approvalsHref} className="mt-2 inline-block font-medium text-violet-strong hover:underline">
              Review in approvals →
            </Link>
          </div>
        )}
        {rec.status === "published" && outcome && <Outcome outcome={outcome} rec={rec} />}
      </footer>
    </article>
  );
}

function Outcome({ outcome, rec }: { outcome: RecommendationOutcome; rec: Recommendation }) {
  const low = rec.assumptions.scenarios[0]!;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div>
        <p className="label text-graphite-500">Actual sales since publishing</p>
        <p className="mt-1 font-display text-2xl font-semibold tabular">{formatPrice(outcome.grossMinor, rec.proposal.currency)}</p>
        <p className="text-xs text-graphite-500">Live confirmed orders only</p>
      </div>
      <div>
        <p className="label text-graphite-500">Tickets sold</p>
        <p className="mt-1 font-display text-2xl font-semibold tabular">
          {outcome.tickets} / {outcome.capacity}
        </p>
        <p className="text-xs text-graphite-500">{outcome.orders} orders</p>
      </div>
      <div>
        <p className="label text-graphite-500">Against the low estimate</p>
        <p className="mt-1 font-display text-2xl font-semibold tabular">{low.grossMinor > 0 ? `${Math.round((outcome.grossMinor / low.grossMinor) * 100)}%` : "—"}</p>
        <p className="text-xs text-graphite-500">of {formatPrice(low.grossMinor, rec.proposal.currency)} at {low.conversionPercent}% conversion</p>
      </div>
    </div>
  );
}

function Row({ term, value, strong = false }: { term: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-graphite-500">{term}</dt>
      <dd className={`tabular ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}
