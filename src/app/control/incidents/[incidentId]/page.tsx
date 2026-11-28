import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { listPlatformActionRequests } from "@/actions";
import { getDb } from "@/infrastructure/db/client";
import { getIncident, incidentKinds } from "@/modules/incidents";
import { isAppError } from "@/shared/errors";
import { controlActor } from "../../_lib/context";
import { ActionButton, AgentButton, PlatformDecision, StatusControls } from "../../_components/control-actions";
import { Heading, OriginBadge, Panel, SeverityBadge, StatusBadge, stamp } from "../../_components/ui";

type Params = Promise<{ incidentId: string }>;

export default function IncidentPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<div aria-busy className="h-96 bg-raised" />}>
      <Incident params={params} />
    </Suspense>
  );
}

const money = (minor: unknown, currency: unknown) =>
  typeof minor === "number" ? `${typeof currency === "string" ? currency : ""} ${(minor / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}`.trim() : null;

async function Incident({ params }: { params: Params }) {
  await connection();
  const { incidentId } = await params;
  const actor = await controlActor(`/control/incidents/${incidentId}`);
  const db = getDb();
  let detail;
  try {
    detail = await getIncident(db, actor, incidentId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const requests = await listPlatformActionRequests(db, actor, { incidentId });
  const { incident, events, timeline, packages } = detail;
  const kind = incidentKinds[incident.kind];
  const commercial = incident.commercialImpact as Record<string, unknown>;
  const technical = incident.technicalImpact as Record<string, unknown>;
  const analysis = incident.analysis as null | {
    summary?: string;
    likelyCauses?: { cause: string; evidence: string[] }[];
    checks?: string[];
    recovery?: string[];
    regressionTest?: string;
    confidence?: string;
    note?: string;
  };
  const amount = money(commercial.amountAtRiskMinor ?? commercial.valueAtRiskMinor, commercial.currency);

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="font-mono text-xs text-graphite-400">
        <Link href="/control/incidents" className="hover:text-graphite-100">Incidents</Link> / <span>{incident.id.slice(0, 8)}</span>
      </nav>
      <Heading eyebrow={`${incident.kind} · ${incident.source}`} title={incident.title}>
        <span className="mt-2 flex flex-wrap items-center gap-2">
          <SeverityBadge severity={incident.severity} />
          <StatusBadge status={incident.status} />
          <OriginBadge origin={incident.origin} />
          <span className="font-mono text-xs text-graphite-400">
            {incident.occurrences}× · first {stamp(incident.firstSeenAt)} · last {stamp(incident.lastSeenAt)}
          </span>
        </span>
      </Heading>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Commercial impact">
          <p className="text-sm">{String(commercial.summary ?? "Not computed.")}</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 font-mono text-xs">
            {amount && (
              <div>
                <dt className="text-graphite-400">Amount at risk</dt>
                <dd className="mt-0.5 text-base text-warning">{amount}</dd>
              </div>
            )}
            {Object.entries(commercial)
              .filter(([k, v]) => typeof v === "number" && !/Minor$/.test(k))
              .map(([k, v]) => (
                <div key={k}>
                  <dt className="text-graphite-400">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</dt>
                  <dd className="mt-0.5 text-base">{String(v)}</dd>
                </div>
              ))}
          </dl>
          <p className="mt-3 text-xs text-graphite-400">Computed from recorded amounts only; failed requests are counted, never priced.</p>
        </Panel>
        <Panel title="Technical impact">
          <dl className="space-y-2 font-mono text-xs">
            {Object.entries(technical).map(([k, v]) =>
              Array.isArray(v) && v.length === 0 ? null : (
                <div key={k} className="grid grid-cols-[9rem_1fr] gap-2">
                  <dt className="text-graphite-400">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</dt>
                  <dd className="break-all">{Array.isArray(v) ? v.join(", ") : String(v)}</dd>
                </div>
              ),
            )}
          </dl>
        </Panel>
      </div>

      <Panel title="Diagnosis" actions={<span className="font-mono text-[0.625rem] uppercase tracking-wider text-graphite-400">{incident.analysisSource === "ai" ? `AI · ${incident.analysisModel} · citations checked` : incident.analysisSource === "rules" ? "Runbook (no AI)" : "Not run yet"}</span>}>
        {analysis ? (
          <div className="space-y-4 text-sm">
            <p>{analysis.summary}</p>
            {analysis.likelyCauses && (
              <div>
                <p className="font-mono text-[0.625rem] uppercase tracking-wider text-graphite-400">Likely causes</p>
                <ul className="mt-1 space-y-1">
                  {analysis.likelyCauses.map((c) => (
                    <li key={c.cause}>
                      {c.cause} <span className="font-mono text-xs text-graphite-400">evidence {c.evidence.map((e) => e.slice(0, 8)).join(", ")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <List title="Checks" items={analysis.checks} />
              <List title="Recovery" items={analysis.recovery} />
            </div>
            {analysis.regressionTest && <p className="text-graphite-300">Regression test: {analysis.regressionTest}</p>}
          </div>
        ) : (
          <div className="grid gap-4 text-sm md:grid-cols-2">
            <List title="Runbook checks" items={kind.runbook.checks} />
            <List title="Runbook recovery" items={kind.runbook.recovery} />
          </div>
        )}
        <div className="mt-4 border-t border-border pt-4">
          <AgentButton incidentId={incident.id} />
          <p className="mt-2 text-xs text-graphite-400">
            The agent reads only the sanitized report. It may prepare a package or request an external investigation; it cannot approve or run one.
          </p>
        </div>
      </Panel>

      <Panel title="Investigation packages" actions={<ActionButton actionId="incident.generate_investigation_package" input={{ incidentId: incident.id }} label="Generate package" done="Package generated (not executed)." />}>
        {packages.length === 0 ? (
          <p className="text-sm text-graphite-400">No package yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {packages.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-mono text-xs">
                    {p.id.slice(0, 8)} · {stamp(p.createdAt)}
                  </p>
                  <p className={`mt-1 text-sm ${p.status === "dispatched" || p.status === "completed" ? "text-lime" : "text-warning"}`}>
                    {p.status === "generated" || p.status === "dispatch_requested" ? "Generated package · not executed" : `${p.status} by ${p.executor ?? "unknown"}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <a href={`/api/control/packages/${p.id}`} className="border border-graphite-500 px-3 py-1.5 font-mono text-xs uppercase tracking-wider hover:border-lime hover:text-lime">
                    Download report (.md)
                  </a>
                  {(p.status === "generated" || p.status === "dispatch_requested") && (
                    <ActionButton actionId="incident.dispatch_investigation" input={{ packageId: p.id }} label="Request external investigation" done="Requested." />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Approvals for this incident">
        {requests.length === 0 ? (
          <p className="text-sm text-graphite-400">No requests. External investigations always need a human approval, whatever the severity and whoever asks.</p>
        ) : (
          <ul className="divide-y divide-border">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 py-3 md:flex-row md:items-start md:justify-between">
                <div className="text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[0.625rem] uppercase tracking-wider text-danger">{r.risk} risk</span>
                    <StatusBadge status={r.status} />
                    <span className="font-mono text-[0.625rem] uppercase tracking-wider text-graphite-300">via {r.initiator.replace("_", " ")}</span>
                  </p>
                  <p className="mt-1">{r.summary}</p>
                  <p className="font-mono text-xs text-graphite-400">
                    by {r.requestedBy.name} · {stamp(r.createdAt)} · hash {r.paramsHash.slice(0, 10)}…
                  </p>
                  {r.status === "failed" && <p className="mt-1 text-xs text-warning">Not executed: {String(r.result?.message ?? r.errorCode)}</p>}
                </div>
                {r.status === "pending_approval" && <PlatformDecision requestId={r.id} paramsHash={r.paramsHash} />}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Timeline">
          <ol className="space-y-2">
            {timeline.map(({ entry, actorName }) => (
              <li key={entry.id} className="grid grid-cols-[8.5rem_1fr] gap-2 text-sm">
                <span className="font-mono text-xs text-graphite-400">{stamp(entry.at)}</span>
                <span>
                  <span className="font-mono text-xs uppercase">{entry.kind.replace(/_/g, " ")}</span>{" "}
                  <span className="text-graphite-300">
                    {entry.actorType === "user" ? `by ${actorName ?? "a user"}` : entry.actorType === "ai_agent" ? `by the AI agent${actorName ? ` for ${actorName}` : ""}` : "by the system"}
                    {entry.detail && typeof entry.detail === "object" && "to" in entry.detail ? ` → ${String((entry.detail as { to: unknown }).to)}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel title={`Evidence (latest ${events.length})`}>
          <ul className="space-y-2">
            {events.slice(0, 12).map((e) => (
              <li key={e.id} className="text-sm">
                <p className="font-mono text-xs text-graphite-400">
                  {e.id.slice(0, 8)} · {stamp(e.occurredAt)}
                  {e.correlationId ? ` · ${e.correlationId.slice(0, 12)}` : ""}
                </p>
                <p className="break-words">{e.message}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="Status">
        <StatusControls incidentId={incident.id} status={incident.status} />
      </Panel>
    </div>
  );
}

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="font-mono text-[0.625rem] uppercase tracking-wider text-graphite-400">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-4">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}
