import type { ReactNode } from "react";

/** Organizer presentational primitives: dense, hairline, tabular. No data access. */

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="label text-graphite-500">{eyebrow}</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.03em] md:text-4xl">{title}</h1>
        {children && <div className="mt-2 max-w-2xl text-sm text-graphite-500">{children}</div>}
      </div>
      {actions}
    </header>
  );
}

export function Stat({ label, value, hint, tone = "default" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "intel" }) {
  return (
    <div className={`bg-raised p-5 ${tone === "intel" ? "shadow-[inset_0_2px_0_var(--color-violet-strong)]" : ""}`}>
      <p className="label text-graphite-500">{label}</p>
      <p className="mt-3 font-display text-3xl font-semibold tracking-tight tabular">{value}</p>
      {hint && <p className="mt-1 text-xs text-graphite-500">{hint}</p>}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "intel" | "success" | "warning" | "danger" | "dark" }) {
  const tones = {
    neutral: "border-graphite-200 text-graphite-500",
    intel: "border-violet-strong/40 bg-violet-strong/5 text-violet-strong",
    success: "border-[#1f7a52]/30 bg-[#1f7a52]/5 text-[#1f7a52]",
    warning: "border-[#8a5300]/30 bg-[#8a5300]/5 text-[#8a5300]",
    danger: "border-[#b42318]/30 bg-[#b42318]/5 text-[#b42318]",
    dark: "border-obsidian bg-obsidian text-offwhite",
  } as const;
  return <span className={`inline-flex items-center gap-1.5 border px-1.5 py-0.5 label text-[0.625rem] ${tones[tone]}`}>{children}</span>;
}

/** Sell-through bar; the number carries the meaning, the bar reinforces it. */
export function Meter({ value, max, tone = "default" }: { value: number; max: number; tone?: "default" | "intel" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <div aria-hidden className="h-1.5 w-24 bg-graphite-100">
        <div className={`h-full ${tone === "intel" ? "bg-violet-strong" : pct >= 100 ? "bg-obsidian" : "bg-graphite-500"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular text-xs text-graphite-500">{pct}%</span>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="border border-dashed border-graphite-200 bg-raised px-6 py-12 text-center">
      <p className="font-display text-xl font-semibold">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-graphite-500">{children}</div>}
    </div>
  );
}

export function NoOrganization() {
  return (
    <Empty title="You’re not part of an organizer team yet.">
      Organizer access is granted by an organization owner. Attendee features stay available on the main site.
    </Empty>
  );
}
