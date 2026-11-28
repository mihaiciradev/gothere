import type { ReactNode } from "react";

/** Control Center primitives: monospace metadata, hairline grids, severity and origin always spelled out in text. */

export function Heading({ eyebrow, title, children, actions }: { eyebrow: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-graphite-400">{eyebrow}</p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
        {children && <div className="mt-1 max-w-3xl text-sm text-graphite-300">{children}</div>}
      </div>
      {actions}
    </header>
  );
}

const severityTone = {
  P0: "border-danger text-danger",
  P1: "border-warning text-warning",
  P2: "border-violet-soft text-violet-soft",
  P3: "border-graphite-500 text-graphite-300",
} as const;
const severityLabel = { P0: "P0 critical", P1: "P1 major", P2: "P2 limited", P3: "P3 minor" } as const;

export function SeverityBadge({ severity }: { severity: keyof typeof severityTone }) {
  return <span className={`inline-flex border px-1.5 py-0.5 font-mono text-[0.625rem] uppercase tracking-wider ${severityTone[severity]}`}>{severityLabel[severity]}</span>;
}

export function OriginBadge({ origin }: { origin: "live" | "simulated" }) {
  return origin === "live" ? (
    <span className="inline-flex items-center gap-1.5 border border-lime/60 px-1.5 py-0.5 font-mono text-[0.625rem] uppercase tracking-wider text-lime">
      <span aria-hidden className="size-1.5 rounded-full bg-lime" />
      Live telemetry
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 border border-dashed border-violet-soft px-1.5 py-0.5 font-mono text-[0.625rem] uppercase tracking-wider text-violet-soft">
      Simulated · demo
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <span className="inline-flex border border-graphite-500 px-1.5 py-0.5 font-mono text-[0.625rem] uppercase tracking-wider text-graphite-200">{status.replace(/_/g, " ")}</span>;
}

export function Tile({ label, value, hint, tone = "default" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "good" | "warn" | "bad" }) {
  const toneClass = { default: "text-graphite-100", good: "text-lime", warn: "text-warning", bad: "text-danger" }[tone];
  return (
    <div className="bg-raised p-4">
      <p className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-graphite-400">{label}</p>
      <p className={`mt-2 font-mono text-2xl tabular ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-graphite-400">{hint}</p>}
    </div>
  );
}

export function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="border border-border bg-raised" aria-label={title}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-graphite-300">{title}</h2>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export const stamp = (d: Date | string) =>
  `${new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC", hour12: false }).format(new Date(d))}Z`;

export const usd = (microUsd: number) => `$${(microUsd / 1_000_000).toFixed(microUsd < 10_000 ? 6 : 4)}`;
