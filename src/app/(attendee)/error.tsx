"use client";

import Link from "next/link";

/** Unexpected failure. The message is generic on purpose; details stay in server logs (by correlation id). */
export default function AttendeeError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="container-edge flex min-h-[70svh] flex-col justify-end pb-16 pt-40">
      <p className="label text-graphite-400">Something went wrong</p>
      <h1 className="mt-4 font-display text-display-lg font-semibold">We dropped the beat.</h1>
      <p className="mt-4 max-w-md text-graphite-300">
        This page couldn’t load. Your tickets and any held reservation are safe — try again in a moment.
      </p>
      <div className="mt-10 flex flex-wrap gap-4">
        <button type="button" onClick={reset} className="inline-flex items-center gap-6 bg-lime px-6 py-4 font-medium text-obsidian hover:bg-offwhite">
          Try again <span aria-hidden>↻</span>
        </button>
        <Link href="/" className="inline-flex items-center border hairline px-6 py-4 hover:border-offwhite">
          Home
        </Link>
      </div>
    </div>
  );
}
