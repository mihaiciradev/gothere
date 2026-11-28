import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { aiStatus } from "@/composition/ai";
import { getDb } from "@/infrastructure/db/client";
import { aiUsageSummary } from "@/modules/incidents";
import { aiSpendThisMonth } from "@/modules/operations";
import { controlActor } from "../_lib/context";
import { Heading, Panel, StatusBadge, Tile, stamp, usd } from "../_components/ui";

export const metadata: Metadata = { title: "AI usage" };

export default function AiPage() {
  return (
    <Suspense fallback={<div aria-busy className="h-96 bg-raised" />}>
      <Ai />
    </Suspense>
  );
}

async function Ai() {
  await connection();
  const actor = await controlActor("/control/ai");
  const db = getDb();
  const [summary, spend] = await Promise.all([aiUsageSummary(db, actor), aiSpendThisMonth(db)]);
  const status = aiStatus();
  const budget = status.monthlyBudgetMinor * 10_000;
  const calls = summary.byFeature.reduce((s, r) => s + r.calls, 0);
  const tokens = summary.byFeature.reduce((s, r) => s + r.input_tokens + r.output_tokens, 0);

  return (
    <div className="space-y-6">
      <Heading eyebrow="AI gateway · this database's ledger" title="AI usage and cost">
        Every provider call reserves its worst-case cost before it is made, so the budget is a hard ceiling. No prompt or
        response content is stored here.
      </Heading>
      <section aria-label="This month" className="grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Spend this month" value={usd(spend)} hint={status.enabled ? `budget ${usd(budget)}` : "AI is off"} tone={budget && spend >= budget ? "warn" : "default"} />
        <Tile label="Budget used" value={budget ? `${Math.min(100, Math.round((spend / budget) * 100))}%` : "—"} />
        <Tile label="Calls this month" value={calls} />
        <Tile label="Tokens this month" value={tokens.toLocaleString("en-GB")} hint={status.model ?? status.reason ?? undefined} />
      </section>
      <Panel title="By feature and outcome (this month)">
        {summary.byFeature.length === 0 ? (
          <p className="text-sm text-graphite-400">No AI calls recorded this month.</p>
        ) : (
          <Table
            head={["Feature", "Outcome", "Calls", "Input tokens", "Output tokens", "Cost"]}
            rows={summary.byFeature.map((r) => [r.feature, <StatusBadge key="s" status={r.status} />, r.calls, r.input_tokens.toLocaleString("en-GB"), r.output_tokens.toLocaleString("en-GB"), usd(r.cost_micro_usd)])}
          />
        )}
      </Panel>
      <Panel title="Daily spend (14 days)">
        {summary.byDay.length === 0 ? (
          <p className="text-sm text-graphite-400">No calls in the last 14 days.</p>
        ) : (
          <Table head={["Day (UTC)", "Calls", "Cost"]} rows={summary.byDay.map((d) => [d.day, d.calls, usd(d.cost_micro_usd)])} />
        )}
      </Panel>
      <Panel title="Latest calls">
        {summary.recent.length === 0 ? (
          <p className="text-sm text-graphite-400">None.</p>
        ) : (
          <Table
            head={["When", "Feature", "Model", "Outcome", "Tokens in/out", "Latency", "Cost"]}
            rows={summary.recent.map((r) => [stamp(r.created_at), r.feature, r.model, <StatusBadge key="s" status={r.status} />, `${r.input_tokens}/${r.output_tokens}`, `${r.latency_ms} ms`, usd(r.cost_micro_usd)])}
          />
        )}
      </Panel>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={head.join(", ")}>
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-border font-mono text-[0.625rem] uppercase tracking-wider text-graphite-400">
            {head.map((h) => (
              <th key={h} scope="col" className="py-2 pr-4 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="py-2 pr-4 font-mono text-xs">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
