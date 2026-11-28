import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { type ActionRequestView, listActionRequests } from "@/actions";
import { formatDay, formatPrice, formatTime } from "@/components/format";
import { getDb } from "@/infrastructure/db/client";
import { organizerContext } from "../_lib/context";
import { DecisionForm } from "../_components/decision-form";
import { Badge, Empty, NoOrganization, PageHeader } from "../_components/ui";

export const metadata: Metadata = { title: "Approvals" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function ApprovalsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div aria-busy className="h-96 bg-graphite-100" />}>
      <Approvals searchParams={searchParams} />
    </Suspense>
  );
}

const initiatorCopy = { ai_agent: "AI agent", automation: "Rules automation", user: "Person" } as const;
const statusTone = { pending_approval: "warning", approved: "intel", executed: "success", rejected: "neutral", expired: "neutral", failed: "danger" } as const;

const stamp = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(d);

async function Approvals({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const ctx = await organizerContext(searchParams, "/organizer/approvals");
  if (!ctx) return <NoOrganization />;
  const requests = await listActionRequests(getDb(), ctx.actor, ctx.organization.id);
  const waiting = requests.filter((r) => r.status === "pending_approval");
  const stuck = requests.filter((r) => r.status === "approved");
  const history = requests.filter((r) => r.status !== "pending_approval" && r.status !== "approved");
  const decidedId = (await searchParams).decided;
  const decided = typeof decidedId === "string" ? requests.find((r) => r.id === decidedId) : undefined;
  const canApprove = ctx.can("action.approve") && ctx.can("experience.publish");

  return (
    <div className="space-y-10">
      <PageHeader eyebrow={ctx.organization.name} title="Approvals">
        High-risk actions requested by an AI agent or automation wait here for a person. You approve the exact parameters
        shown; if anything changes, the request must be made again.
      </PageHeader>

      {decided && <Outcome request={decided} />}

      <section aria-labelledby="waiting-title">
        <h2 id="waiting-title" className="font-display text-xl font-semibold tracking-tight">
          Waiting for a decision <span className="tabular text-graphite-500">({waiting.length})</span>
        </h2>
        <div className="mt-4 space-y-4">
          {waiting.length === 0 && stuck.length === 0 ? (
            <Empty title="Nothing waiting.">When the agent prepares a recommendation, its publication request appears here.</Empty>
          ) : (
            [...stuck, ...waiting].map((r) => <RequestCard key={r.id} request={r} organizationId={ctx.organization.id} canApprove={canApprove} actorId={ctx.actor.userId} />)
          )}
        </div>
      </section>

      <section aria-labelledby="history-title">
        <h2 id="history-title" className="font-display text-xl font-semibold tracking-tight">
          History
        </h2>
        {history.length === 0 ? (
          <p className="mt-4 text-sm text-graphite-500">No decisions yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto border border-border bg-raised" tabIndex={0} role="region" aria-label="Decision history table">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {["Action", "Requested by", "Decision", "Outcome"].map((h) => (
                    <th key={h} scope="col" className="px-4 py-3 label font-normal text-graphite-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id} className="border-b border-border align-top last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium">{r.summary}</p>
                      <p className="font-mono text-xs text-graphite-500">{r.actionId}</p>
                    </td>
                    <td className="px-4 py-3">
                      {r.requestedBy.name}
                      <p className="text-xs text-graphite-500">via {initiatorCopy[r.initiator]} · {stamp(r.createdAt)}</p>
                    </td>
                    <td className="px-4 py-3">
                      {r.decidedBy ? (
                        <>
                          {r.decidedBy.name}
                          {r.decidedAt && <p className="text-xs text-graphite-500">{stamp(r.decidedAt)}</p>}
                          {r.decisionNote && <p className="mt-1 text-xs text-graphite-500">“{r.decisionNote}”</p>}
                        </>
                      ) : (
                        <span className="text-graphite-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone[r.status]}>{r.status.replace("_", " ")}</Badge>
                      {r.errorCode && <p className="mt-1 text-xs text-[#b42318]">{String(r.result?.message ?? r.errorCode)}</p>}
                    </td>
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

function RequestCard({ request: r, organizationId, canApprove, actorId }: { request: ActionRequestView; organizationId: string; canApprove: boolean; actorId: string }) {
  const snapshot = (r.params as { snapshot?: { title: string; startsAt: string; endsAt: string; capacity: number; priceMinor: number; currency: string; timeZone?: string } }).snapshot;
  return (
    <article className="border border-border bg-raised">
      <header className="flex flex-col gap-2 border-b border-border p-5 md:flex-row md:items-start md:justify-between md:p-6">
        <div>
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone="danger">{r.risk} risk</Badge>
            <Badge tone={r.initiator === "ai_agent" ? "intel" : "neutral"}>{initiatorCopy[r.initiator]}</Badge>
            <Badge tone={statusTone[r.status]}>{r.status.replace("_", " ")}</Badge>
          </p>
          <h3 className="mt-3 font-display text-xl font-semibold tracking-tight">{r.summary}</h3>
          <p className="mt-1 text-sm text-graphite-500">
            Requested by {r.requestedBy.name} via {initiatorCopy[r.initiator].toLowerCase()} · {stamp(r.createdAt)} · expires {stamp(r.expiresAt)}
          </p>
        </div>
      </header>
      <div className="grid gap-px bg-border md:grid-cols-2">
        <section aria-label="Parameters" className="bg-raised p-5 md:p-6">
          <p className="label text-graphite-500">You are approving</p>
          {snapshot ? (
            <dl className="mt-3 space-y-2 text-sm">
              <Row term="Action" value={r.actionTitle} />
              <Row term="Experience" value={snapshot.title} />
              <Row term="Starts" value={snapshot.timeZone ? `${formatDay(new Date(snapshot.startsAt), snapshot.timeZone)}, ${formatTime(new Date(snapshot.startsAt), snapshot.timeZone)} (event time)` : stamp(new Date(snapshot.startsAt))} />
              <Row term="Places" value={String(snapshot.capacity)} />
              <Row term="Price" value={formatPrice(snapshot.priceMinor, snapshot.currency)} />
            </dl>
          ) : (
            <pre tabIndex={0} aria-label="Request parameters" className="mt-3 overflow-x-auto bg-offwhite p-3 font-mono text-xs">{JSON.stringify(r.params, null, 2)}</pre>
          )}
          <p className="mt-4 font-mono text-[0.6875rem] text-graphite-500" title={r.paramsHash}>
            Parameter hash {r.paramsHash.slice(0, 12)}…{r.paramsHash.slice(-6)}
          </p>
        </section>
        <section aria-label="Decision" className="bg-raised p-5 md:p-6">
          {r.status === "approved" ? (
            r.decidedBy?.id === actorId ? (
              <>
                <p className="mb-3 text-sm text-graphite-500">You approved this, but execution did not complete. Run it now; it executes at most once.</p>
                <DecisionForm organizationId={organizationId} requestId={r.id} paramsHash={r.paramsHash} mode="execute" />
              </>
            ) : (
              <p className="text-sm text-graphite-500">Approved by {r.decidedBy?.name}; waiting for them to execute it.</p>
            )
          ) : canApprove ? (
            <DecisionForm organizationId={organizationId} requestId={r.id} paramsHash={r.paramsHash} />
          ) : (
            <p className="text-sm text-graphite-500">Your role can see this request but cannot approve it. An owner or manager must decide.</p>
          )}
        </section>
      </div>
    </article>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-graphite-500">{term}</dt>
      <dd className="text-right tabular font-medium">{value}</dd>
    </div>
  );
}

/** The result of a decision just taken, read back from the stored request (not from the client). */
function Outcome({ request: r }: { request: ActionRequestView }) {
  const copy =
    r.status === "executed"
      ? { tone: "border-[#1f7a52] text-[#1f7a52]", title: "Approved and executed. The experience is on sale.", body: r.summary }
      : r.status === "rejected"
        ? { tone: "border-graphite-500 text-obsidian", title: "Rejected. Nothing was changed.", body: r.summary }
        : r.status === "failed"
          ? { tone: "border-[#b42318] text-[#b42318]", title: "Approved, but execution failed. Nothing was published.", body: String(r.result?.message ?? r.errorCode ?? "") }
          : r.status === "expired"
            ? { tone: "border-[#8a5300] text-[#8a5300]", title: "This request expired before a decision.", body: r.summary }
            : null;
  if (!copy) return null;
  return (
    <div role="status" className={`border-l-2 bg-raised px-5 py-4 ${copy.tone}`}>
      <p className="font-medium">{copy.title}</p>
      <p className="mt-1 text-sm text-graphite-500">{copy.body}</p>
    </div>
  );
}
