import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ControlNav } from "./_components/control-nav";

export const metadata: Metadata = { title: { default: "Control Center", template: "%s · Control · gothere" }, robots: { index: false } };

/** Control Center shell: technical, dense, monospace metadata. Platform administrators only (checked per page). */
export default function ControlLayout({ children }: LayoutProps<"/control">) {
  return (
    <div data-surface="control" className="flex min-h-full flex-1 flex-col bg-bg text-fg">
      <a href="#main" className="sr-only z-[60] bg-lime px-4 py-2 text-obsidian focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 md:h-12 md:flex-nowrap md:py-0 md:px-8">
          <Link href="/control" className="flex items-baseline gap-2">
            <span className="font-display text-base font-semibold tracking-[-0.04em]" aria-label="gothere">
              gothere<span className="text-lime">.</span>
            </span>
            <span className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-graphite-300">Control</span>
          </Link>
          <div className="order-last w-full md:order-none md:w-auto">
            <Suspense fallback={<div className="h-7" />}>
              <ControlNav />
            </Suspense>
          </div>
          <span className="ml-auto hidden font-mono text-[0.6875rem] text-graphite-400 md:block">platform admin</span>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 pb-20 pt-6 md:px-8 md:pt-10">
        {children}
      </main>
    </div>
  );
}
