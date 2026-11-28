import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { safeRedirectPath } from "@/shared/redirect";

export const metadata: Metadata = { title: "Private preview", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const messages: Record<string, string> = {
  invalid: "That password is not right.",
  rate: "Too many attempts. Wait ten minutes and try again.",
};

/** Pre-release gate. Plain HTML form: works without JavaScript; the check happens on the server. */
export default function AccessPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main data-surface="attendee" className="flex min-h-svh flex-1 items-center justify-center bg-bg px-6 text-fg">
      <div className="w-full max-w-sm">
        <p className="font-display text-3xl font-semibold tracking-[-0.04em]">
          gothere<span className="text-lime">.</span>
        </p>
        <h1 className="mt-8 font-display text-2xl font-semibold">Private preview</h1>
        <p className="mt-2 text-sm text-graphite-300">This prototype is not public yet. Enter the access password you were given.</p>
        <Suspense fallback={<GateForm next="/" />}>
          <GateFormFromParams searchParams={searchParams} />
        </Suspense>
        <p className="mt-8 text-xs text-graphite-400">
          Fictional events, simulated payments. <Link href="/privacy" className="underline hover:text-lime">Privacy notice</Link>
        </p>
      </div>
    </main>
  );
}

async function GateFormFromParams({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeRedirectPath(typeof params.next === "string" ? params.next : "/", "/");
  const error = typeof params.error === "string" ? messages[params.error] : undefined;
  return <GateForm next={next} error={error} />;
}

function GateForm({ next, error }: { next: string; error?: string }) {
  return (
    <form action="/api/access" method="post" className="mt-6 space-y-4">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="password" className="label text-graphite-300">
        Access password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        required
        autoComplete="current-password"
        aria-describedby={error ? "access-error" : undefined}
        className="mt-2 w-full border-b border-graphite-600 bg-transparent py-3 text-lg text-offwhite focus:border-lime focus:outline-none"
      />
      {error && (
        <p id="access-error" role="alert" className="text-sm text-warning">
          {error}
        </p>
      )}
      <button type="submit" className="label w-full bg-lime px-6 py-4 text-obsidian transition-colors hover:bg-offwhite">
        Enter
      </button>
    </form>
  );
}
