import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/infrastructure/db/client";
import { recentTransactions } from "@/modules/incidents";
import { controlActor } from "../_lib/context";
import { Heading, Panel, StatusBadge, Tile, stamp } from "../_components/ui";

export const metadata: Metadata = { title: "Transactions" };

export default function TransactionsPage() {
  return (
    <Suspense fallback={<div aria-busy className="h-96 bg-raised" />}>
      <Transactions />
    </Suspense>
  );
}

const money = (minor: number, currency: string) => `${currency} ${(minor / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function Transactions() {
  await connection();
  const actor = await controlActor("/control/transactions");
  const { attempts, totals } = await recentTransactions(getDb(), actor);
  const live = totals.find((t) => t.origin === "live");
  const seed = totals.find((t) => t.origin === "seed");

  return (
    <div className="space-y-6">
      <Heading eyebrow="Payments · simulated provider" title="Transactions">
        All payments are simulated; no money moves. Seeded history and live activity are reported separately.
      </Heading>
      <section aria-label="Last 30 days" className="grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Live orders (30 d)" value={live?.orders ?? 0} hint={live ? money(live.gross_minor, "EUR") : "none"} />
        <Tile label="Seeded orders (30 d)" value={seed?.orders ?? 0} hint="demonstration history" />
        <Tile label="Refunds required" value={(live?.refunds_required ?? 0) + (seed?.refunds_required ?? 0)} tone={(live?.refunds_required ?? 0) > 0 ? "warn" : "default"} />
        <Tile label="Refunded" value={(live?.refunded ?? 0) + (seed?.refunded ?? 0)} />
      </section>
      <Panel title={`Latest ${attempts.length} payment attempts`}>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Payment attempts table">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-border font-mono text-[0.625rem] uppercase tracking-wider text-graphite-400">
                {["Created", "Event", "Amount", "Provider status", "Decision", "Hold", "Order", "Origin"].map((h) => (
                  <th key={h} scope="col" className="py-2 pr-4 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs text-graphite-300">{stamp(a.created_at)}</td>
                  <td className="py-2 pr-4">{a.event_title}</td>
                  <td className="py-2 pr-4 font-mono text-xs tabular">{money(a.amount_minor, a.currency)}</td>
                  <td className="py-2 pr-4"><StatusBadge status={a.status} /></td>
                  <td className={`py-2 pr-4 font-mono text-xs ${a.disposition === "refund_required" ? "text-warning" : a.disposition === "accepted" ? "text-lime" : "text-graphite-300"}`}>{a.disposition}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{a.reservation_status}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{a.order_id ? a.order_id.slice(0, 8) : "—"}</td>
                  <td className="py-2 font-mono text-xs text-graphite-300">{a.origin}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
