import Link from "next/link";
import { Suspense } from "react";
import { currentActor } from "../_lib/session";
import { HeaderShell } from "@/components/site/header-shell";
import { SignOutButton } from "@/components/site/sign-out-button";

async function SessionArea({ variant }: { variant: "desktop" | "mobile" }) {
  const actor = await currentActor();
  if (!actor) {
    return variant === "desktop" ? (
      <div className="flex items-center gap-5">
        <Link href="/sign-in" className="label text-graphite-300 hover:text-offwhite">Sign in</Link>
        <Link href="/sign-up" className="label bg-lime px-4 py-2.5 text-obsidian transition-colors hover:bg-offwhite">
          Create account
        </Link>
      </div>
    ) : (
      <div className="flex gap-3">
        <Link href="/sign-in" className="label flex-1 border hairline px-4 py-4 text-center">Sign in</Link>
        <Link href="/sign-up" className="label flex-1 bg-lime px-4 py-4 text-center text-obsidian">Create account</Link>
      </div>
    );
  }
  const initial = actor.email.slice(0, 1).toUpperCase();
  return variant === "desktop" ? (
    <div className="flex items-center gap-5">
      <span className="flex items-center gap-2 label text-graphite-300">
        <span aria-hidden className="grid size-7 place-items-center bg-offwhite font-sans text-xs font-semibold text-obsidian">{initial}</span>
        <span className="sr-only">Signed in as</span>
        <span className="max-w-40 truncate normal-case tracking-normal">{actor.email}</span>
      </span>
      <SignOutButton className="label text-graphite-300 hover:text-offwhite" />
    </div>
  ) : (
    <div className="flex items-center justify-between border-t hairline pt-6">
      <span className="truncate text-sm text-graphite-300">{actor.email}</span>
      <SignOutButton className="label text-offwhite" />
    </div>
  );
}

const SessionFallback = () => <span className="label text-graphite-400">…</span>;

export function SiteHeader() {
  return (
    <HeaderShell
      session={
        <Suspense fallback={<SessionFallback />}>
          <SessionArea variant="desktop" />
        </Suspense>
      }
      mobileSession={
        <Suspense fallback={<SessionFallback />}>
          <SessionArea variant="mobile" />
        </Suspense>
      }
    />
  );
}
