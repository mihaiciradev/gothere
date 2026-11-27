"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { categoryLabels, formatDateRange, formatPrice } from "@/components/format";
import { AvailabilityTag } from "@/components/ui/availability-tag";

type Pick = {
  event: {
    slug: string;
    title: string;
    city: string;
    category: string;
    timeZone: string;
    startsAt: string;
    endsAt: string;
    fromPriceMinor: number | null;
    currency: string | null;
    availability: "available" | "limited" | "sold_out" | "not_on_sale";
  };
  experience: { slug: string; title: string; priceMinor: number | null; currency: string | null; soldOut: boolean } | null;
  why: string;
};
type Answer = { mode: "ai" | "search"; reply: string; notice: string | null; picks: Pick[] };

const examples = ["Jazz in Bucharest under €50", "Something by the sea in July", "A techno weekend in Cluj"];

/**
 * The concierge. Answers come from the server: with AI, a model choosing among real catalogue results; without it,
 * a deterministic search. Prices, dates and availability on the cards are always the database's, never the model's.
 * Without JavaScript the form is a plain catalogue search.
 */
export function Concierge({ compact = false }: { compact?: boolean }) {
  const inputId = useId();
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [asked, setAsked] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  // Hidden <Activity> routes keep their state; abort and reset an in-flight request when this page is hidden.
  useEffect(
    () => () => {
      controller.current?.abort();
      setPending(false);
    },
    [],
  );

  async function ask(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 2 || pending) return;
    controller.current?.abort();
    controller.current = new AbortController();
    setPending(true);
    setError(null);
    setAsked(trimmed);
    try {
      const response = await fetch("/api/concierge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
        signal: controller.current.signal,
      });
      const body = (await response.json()) as { data?: Answer; error?: { message?: string } };
      if (response.ok && body.data) setAnswer(body.data);
      else setError(response.status === 429 ? "That was a lot of questions at once. Give it a minute." : (body.error?.message ?? "The concierge couldn’t answer. Try the search instead."));
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError("Network problem. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby={`${inputId}-title`} className={compact ? "" : "container-edge pt-28 md:pt-36"}>
      <div className={`relative overflow-hidden border border-violet/40 bg-graphite-900 ${compact ? "p-5 md:p-8" : "p-6 md:p-14"}`}>
        <div aria-hidden className="absolute top-0 left-0 h-px w-1/3 bg-violet" />
        <p className="flex items-center gap-3 label text-violet-soft">
          <span aria-hidden className="size-1.5 bg-violet" />
          Concierge
        </p>
        <h2 id={`${inputId}-title`} className={`mt-4 max-w-3xl font-display font-semibold tracking-[-0.03em] ${compact ? "text-2xl md:text-3xl" : "text-[clamp(2rem,4.6vw,3.75rem)] leading-[1]"}`}>
          Tell us the night you’re after.
        </h2>
        <form
          action="/discover"
          method="get"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(message);
          }}
          className="mt-6 flex flex-col gap-3 md:flex-row"
        >
          <label htmlFor={inputId} className="sr-only">
            Describe what you’re looking for: kind of night, city, month, budget
          </label>
          <input
            id={inputId}
            name="q"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={500}
            autoComplete="off"
            placeholder="jazz in Bucharest under €50, sunset by the sea…"
            className="min-w-0 flex-1 border-b border-graphite-600 bg-transparent py-3 text-xl text-offwhite placeholder:text-graphite-400 focus:border-violet focus:outline-none md:text-2xl"
          />
          <button type="submit" disabled={pending} className="label bg-offwhite px-6 py-4 text-obsidian transition-colors hover:bg-lime disabled:bg-graphite-300">
            {pending ? "Looking…" : "Ask"}
          </button>
        </form>
        {!answer && !pending && (
          <ul className="mt-5 flex flex-wrap gap-2" aria-label="Examples">
            {examples.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  onClick={() => {
                    setMessage(example);
                    void ask(example);
                  }}
                  className="border border-graphite-700 px-3 py-1.5 text-sm text-graphite-300 transition-colors hover:border-violet hover:text-offwhite"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div aria-live="polite" aria-busy={pending} className="mt-6">
          {pending && <p className="label animate-live text-violet-soft">Checking live availability…</p>}
          {error && <p role="alert" className="border-l-2 border-warning pl-4 text-sm text-graphite-300">{error}</p>}
          <AnimatePresence mode="wait">
            {answer && !pending && (
              <motion.div key={asked} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                <p className="max-w-3xl text-lg text-offwhite">{answer.reply}</p>
                <p className="mt-2 flex items-center gap-2 label text-graphite-400">
                  <span aria-hidden className={`size-1.5 ${answer.mode === "ai" ? "bg-violet" : "bg-graphite-500"}`} />
                  {answer.mode === "ai" ? "AI picks from live listings · prices from our ticketing" : "Plain search · no AI involved"}
                </p>
                {answer.notice && <p className="mt-2 text-sm text-graphite-400">{answer.notice}</p>}
                {answer.picks.length > 0 && (
                  <ol className={`mt-6 grid gap-px bg-graphite-700 ${answer.picks.length > 1 ? "md:grid-cols-2" : ""}`}>
                    {answer.picks.map((pick) => (
                      <li key={`${pick.event.slug}-${pick.experience?.slug ?? ""}`} className="bg-graphite-900">
                        <PickCard pick={pick} />
                      </li>
                    ))}
                  </ol>
                )}
                <Link href={`/discover?q=${encodeURIComponent(asked.slice(0, 80))}`} className="mt-6 inline-block label text-graphite-300 hover:text-lime">
                  Search the full catalogue instead →
                </Link>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

function PickCard({ pick }: { pick: Pick }) {
  const { event, experience } = pick;
  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  const price =
    experience?.priceMinor != null && experience.currency
      ? formatPrice(experience.priceMinor, experience.currency)
      : event.fromPriceMinor !== null && event.currency
        ? `from ${formatPrice(event.fromPriceMinor, event.currency)}`
        : null;
  return (
    <Link href={`/events/${event.slug}${experience ? "#tickets" : ""}`} className="group flex h-full flex-col p-5 md:p-6">
      <p className="flex flex-wrap gap-x-3 label text-graphite-400">
        <span>{categoryLabels[event.category]?.replace(/s$/, "") ?? event.category}</span>
        <span>{formatDateRange(startsAt, endsAt, event.timeZone)}</span>
        <span>{event.city}</span>
      </p>
      <p className="mt-3 font-display text-2xl font-semibold tracking-tight transition-colors group-hover:text-lime">{event.title}</p>
      {experience && <p className="mt-1 text-offwhite">{experience.title}</p>}
      <p className="mt-2 text-sm text-graphite-300">{pick.why}</p>
      <div className="mt-auto flex items-center justify-between gap-4 pt-5">
        {price && <span className="tabular text-offwhite">{price}</span>}
        <AvailabilityTag status={experience ? (experience.soldOut ? "sold_out" : "available") : event.availability} />
      </div>
    </Link>
  );
}
