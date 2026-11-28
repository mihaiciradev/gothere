import Link from "next/link";
import type { IncidentRow } from "@/modules/incidents";
import { OriginBadge, SeverityBadge, StatusBadge, stamp } from "./ui";

export function IncidentList({ incidents, empty }: { incidents: IncidentRow[]; empty: string }) {
  if (incidents.length === 0) return <p className="text-sm text-graphite-400">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {incidents.map((i) => (
        <li key={i.id}>
          <Link href={`/control/incidents/${i.id}`} className="flex flex-col gap-1.5 py-3 hover:bg-bg md:flex-row md:items-center md:gap-4">
            <span className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={i.severity} />
              <StatusBadge status={i.status} />
              <OriginBadge origin={i.origin} />
            </span>
            <span className="flex-1 text-sm">{i.title}</span>
            <span className="font-mono text-xs text-graphite-400">
              {i.occurrences}× · last {stamp(i.lastSeenAt)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
