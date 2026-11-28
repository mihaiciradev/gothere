import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/infrastructure/db/client";
import { incidentFiltersSchema, listIncidents } from "@/modules/incidents";
import { controlActor } from "../_lib/context";
import { Heading, Panel } from "../_components/ui";
import { IncidentList } from "../_components/incident-list";

export const metadata: Metadata = { title: "Incidents" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const filterSets = {
  status: ["unresolved", "open", "investigating", "mitigated", "resolved"],
  severity: ["P0", "P1", "P2", "P3"],
  origin: ["live", "simulated"],
} as const;

export default function IncidentsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div aria-busy className="h-96 bg-raised" />}>
      <Incidents searchParams={searchParams} />
    </Suspense>
  );
}

async function Incidents({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const actor = await controlActor("/control/incidents");
  const raw = await searchParams;
  const candidate = Object.fromEntries(Object.keys(filterSets).flatMap((k) => (typeof raw[k] === "string" ? [[k, raw[k]]] : [])));
  const parsed = incidentFiltersSchema.safeParse(candidate);
  const filters = parsed.success ? parsed.data : {};
  const rows = await listIncidents(getDb(), actor, filters);
  const href = (key: string, value?: string) => {
    const next = new URLSearchParams(Object.entries({ ...filters, [key]: value }).filter(([, v]) => v) as [string, string][]);
    return next.size ? `/control/incidents?${next}` : "/control/incidents";
  };

  return (
    <div className="space-y-6">
      <Heading eyebrow="Engineering intelligence" title="Incidents">
        Deduplicated by fingerprint: repeated occurrences of the same problem attach to one open incident.
      </Heading>
      <nav aria-label="Filters" className="space-y-2">
        {(Object.entries(filterSets) as [keyof typeof filterSets, readonly string[]][]).map(([key, values]) => (
          <div key={key} className="flex flex-wrap items-center gap-2">
            <span className="w-16 font-mono text-[0.625rem] uppercase tracking-wider text-graphite-400">{key}</span>
            <Link href={href(key)} aria-current={!filters[key] ? "true" : undefined} className={`font-mono text-xs ${!filters[key] ? "text-lime" : "text-graphite-300 hover:text-graphite-100"}`}>
              all
            </Link>
            {values.map((v) => (
              <Link key={v} href={href(key, v)} aria-current={filters[key] === v ? "true" : undefined} className={`font-mono text-xs ${filters[key] === v ? "text-lime" : "text-graphite-300 hover:text-graphite-100"}`}>
                {v}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <Panel title={`${rows.length} incident${rows.length === 1 ? "" : "s"}`}>
        <IncidentList incidents={rows} empty="No incidents match these filters." />
      </Panel>
    </div>
  );
}
