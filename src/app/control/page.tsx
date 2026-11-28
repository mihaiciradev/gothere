import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { aiStatus } from "@/composition/ai";
import { getDb } from "@/infrastructure/db/client";
import { serverEnv } from "@/infrastructure/env";
import { aiSpendThisMonth } from "@/modules/operations";
import { healthSnapshot, listIncidents, recentAudit, simulationScenarios } from "@/modules/incidents";
import { controlActor } from "./_lib/context";
import { SimulateButtons } from "./_components/control-actions";
import { IncidentList } from "./_components/incident-list";
import { Heading, Panel, Tile, stamp, usd } from "./_components/ui";

export default function ControlHome() {
  return (
    <Suspense fallback={<div aria-busy className="h-96 bg-raised" />}>
      <Health />
    </Suspense>
  );
}

async function Health() {
  await connection();
  const actor = await controlActor("/control");
  const db = getDb();
  const [health, open, audit, spend] = await Promise.all([
    healthSnapshot(db, actor),
    listIncidents(db, actor, { status: "unresolved" }),
    recentAudit(db, actor, 12),
    aiSpendThisMonth(db),
  ]);
  const ai = aiStatus();
  const budget = ai.monthlyBudgetMinor * 10_000;
  const simulations = serverEnv().APP_ENV !== "production";
  const live = open.filter((i) => i.origin === "live");
  const simulated = open.filter((i) => i.origin === "simulated");

  return (
    <div className="space-y-8">
      <Heading eyebrow={`Environment · ${serverEnv().APP_ENV}`} title="System health">
        Live telemetry from this database. Simulated demonstration incidents are counted and listed separately.
      </Heading>

      <section aria-label="Health indicators" className="grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Database round trip" value={`${health.dbLatencyMs} ms`} tone={health.dbLatencyMs > 500 ? "warn" : "good"} />
        <Tile label="Open live incidents" value={health.incidents_open} hint={`P0 ${health.p0} · P1 ${health.p1} · P2 ${health.p2} · P3 ${health.p3}`} tone={health.p0 + health.p1 > 0 ? "bad" : health.incidents_open > 0 ? "warn" : "good"} />
        <Tile label="Jobs" value={`${health.queued} queued`} hint={`${health.due} due · ${health.running} running · ${health.dead_24h} dead (24 h)`} tone={health.dead_24h > 0 ? "warn" : "default"} />
        <Tile label="Holds" value={`${health.active_holds} active`} hint={`${health.overdue_holds} overdue awaiting the sweep`} tone={health.overdue_holds > 20 ? "warn" : "default"} />
        <Tile label="Payments in flight" value={health.pending_payments} hint={`${health.refunds_required} refunds required`} tone={health.refunds_required > 0 ? "warn" : "default"} />
        <Tile label="Live orders (24 h)" value={health.orders_24h} />
        <Tile label="AI spend (month)" value={usd(spend)} hint={ai.enabled ? `of ${usd(budget)} budget · ${ai.model}` : `AI off: ${ai.reason}`} tone={budget && spend >= budget ? "warn" : "default"} />
        <Tile label="Simulated incidents" value={health.simulated_open} hint="Demonstration records, not telemetry" />
      </section>

      <Panel title={`Open live incidents (${live.length})`} actions={<Link href="/control/incidents" className="font-mono text-xs text-graphite-300 hover:text-lime">All incidents →</Link>}>
        <IncidentList incidents={live} empty="No open incidents from live telemetry." />
      </Panel>

      <Panel title={`Simulated incidents (${simulated.length})`}>
        <p className="mb-3 text-sm text-graphite-300">
          Records only: nothing fails and no real data is touched. Use them to walk through detection, analysis and governed investigation.
        </p>
        {simulations ? (
          <SimulateButtons scenarios={Object.entries(simulationScenarios).map(([id, s]) => ({ id, label: s.label }))} />
        ) : (
          <p className="text-sm text-graphite-400">Simulations are disabled in production.</p>
        )}
        <div className="mt-4">
          <IncidentList incidents={simulated} empty="None open." />
        </div>
      </Panel>

      <Panel title="Recent audit trail">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Recent audit trail table">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-border font-mono text-[0.625rem] uppercase tracking-wider text-graphite-400">
                <th scope="col" className="py-2 pr-4 font-normal">When</th>
                <th scope="col" className="py-2 pr-4 font-normal">Actor</th>
                <th scope="col" className="py-2 pr-4 font-normal">Action</th>
                <th scope="col" className="py-2 font-normal">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs text-graphite-300">{stamp(a.occurredAt)}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{a.actorType}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{a.action}</td>
                  <td className={`py-2 font-mono text-xs ${a.outcome === "succeeded" ? "text-lime" : "text-warning"}`}>{a.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
