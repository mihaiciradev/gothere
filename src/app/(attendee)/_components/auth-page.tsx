import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Photo } from "@/components/media/photo";
import { safeRedirectPath } from "@/shared/redirect";
import { currentActor } from "../_lib/session";
import { AuthForm } from "./auth-form";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const copy = {
  "sign-in": { eyebrow: "Welcome back", title: "Sign in to your nights." },
  "sign-up": { eyebrow: "Create account", title: "Your tickets, in one place." },
} as const;

async function FormArea({ mode, searchParams }: { mode: "sign-in" | "sign-up"; searchParams: SearchParams }) {
  const raw = (await searchParams).next;
  const next = safeRedirectPath(Array.isArray(raw) ? raw[0] : raw);
  if (await currentActor()) redirect(next);
  return <AuthForm mode={mode} next={next} />;
}

export function AuthPage({ mode, searchParams }: { mode: "sign-in" | "sign-up"; searchParams: SearchParams }) {
  return (
    <div className="grid min-h-[100svh] md:grid-cols-2">
      <div className="relative hidden md:block">
        <Photo
          src="https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3"
          alt=""
          sizes="50vw"
          fill
          priority
          credit="Photo: Yvette de Wit / Unsplash"
        />
        <div className="absolute inset-0 scrim-bottom" />
        <p className="absolute bottom-12 left-12 max-w-md font-display text-5xl font-semibold leading-[0.95] tracking-[-0.03em] text-offwhite">
          Every ticket, every hold, every night — kept together.
        </p>
      </div>
      <div className="container-edge flex items-center py-28 md:px-16">
        <div className="w-full max-w-md">
          <p className="label text-graphite-400">{copy[mode].eyebrow}</p>
          <h1 className="mt-3 font-display text-5xl font-semibold leading-[0.95] tracking-[-0.03em]">{copy[mode].title}</h1>
          <div className="mt-12">
            <Suspense fallback={<div className="h-80" />}>
              <FormArea mode={mode} searchParams={searchParams} />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
