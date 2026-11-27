import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";

/** Unmatched URLs (outside any route group). Self-contained: the attendee chrome is not mounted here. */
export default function RootNotFound() {
  return (
    <main data-surface="attendee" className="flex min-h-[100svh] flex-col justify-between bg-bg px-6 py-8 text-fg sm:px-12">
      <Link href="/" className="text-2xl" aria-label="gothere home">
        <Wordmark />
      </Link>
      <div>
        <p className="label text-graphite-400">404 · Not found</p>
        <h1 className="mt-4 font-display text-display-lg font-semibold">This page isn’t on the lineup.</h1>
        <Link href="/discover" className="mt-10 inline-flex items-center gap-6 bg-lime px-6 py-4 font-medium text-obsidian hover:bg-offwhite">
          Discover events <span aria-hidden>→</span>
        </Link>
      </div>
      <p className="label text-graphite-400">gothere prototype</p>
    </main>
  );
}
