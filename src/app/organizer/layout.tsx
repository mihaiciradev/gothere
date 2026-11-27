import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { MotionProvider } from "@/components/motion/motion-provider";
import { OrganizerNav } from "./_components/organizer-nav";

export const metadata: Metadata = { title: { default: "Organizer", template: "%s · Organizer · gothere" } };

/** Organizer platform shell: light, structured, commercially focused. Session and data stream in per page. */
export default function OrganizerLayout({ children }: LayoutProps<"/organizer">) {
  return (
    <MotionProvider>
      <div data-surface="organizer" className="flex min-h-full flex-1 flex-col bg-bg text-fg">
        <a href="#main" className="sr-only z-[60] bg-obsidian px-4 py-2 text-offwhite focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
          Skip to content
        </a>
        <header className="sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 md:h-14 md:flex-nowrap md:py-0 md:px-8">
            <Link href="/organizer" className="flex items-baseline gap-2">
              <span className="font-display text-lg font-semibold tracking-[-0.04em]" aria-label="gothere">
                gothere<span className="text-violet-strong">.</span>
              </span>
              <span className="label text-graphite-500">Organizer</span>
            </Link>
            <div className="order-last w-full md:order-none md:w-auto">
              <Suspense fallback={<div className="h-9" />}>
                <OrganizerNav />
              </Suspense>
            </div>
            <Link href="/" className="ml-auto hidden text-sm text-graphite-500 hover:text-obsidian md:block">
              View attendee site ↗
            </Link>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 pb-24 pt-8 md:px-8 md:pt-12">
          {children}
        </main>
      </div>
    </MotionProvider>
  );
}
