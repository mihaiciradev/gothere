/**
 * Entry point reserved for the M3 concierge. Today it is honest keyword search over real catalogue data;
 * it does not imitate a conversation. Violet marks intelligence features across the product.
 */
export function ConciergeEntry({ defaultValue = "", compact = false }: { defaultValue?: string; compact?: boolean }) {
  return (
    <section aria-labelledby="concierge-title" className={compact ? "" : "container-edge pt-28 md:pt-36"}>
      <div className={`relative overflow-hidden border border-violet/40 bg-graphite-900 ${compact ? "p-6 md:p-8" : "p-6 md:p-14"}`}>
        <div aria-hidden className="absolute top-0 left-0 h-px w-1/3 bg-violet" />
        <p className="flex items-center gap-3 label text-violet-soft">
          <span aria-hidden className="size-1.5 bg-violet" />
          Concierge · arriving in the next release
        </p>
        <h2
          id="concierge-title"
          className={`mt-5 max-w-3xl font-display font-semibold tracking-[-0.03em] ${compact ? "text-3xl" : "text-[clamp(2rem,4.6vw,3.75rem)] leading-[1]"}`}
        >
          Tell us the night you’re after.
        </h2>
        <form action="/discover" method="get" role="search" className="mt-8 flex flex-col gap-3 md:flex-row">
          <label htmlFor={compact ? "concierge-q-compact" : "concierge-q"} className="sr-only">
            Search events, cities and experiences
          </label>
          <input
            id={compact ? "concierge-q-compact" : "concierge-q"}
            name="q"
            defaultValue={defaultValue}
            maxLength={80}
            placeholder="jazz in Sibiu, sunset sessions, techno…"
            className="min-w-0 flex-1 border-b border-graphite-600 bg-transparent py-3 text-xl text-offwhite placeholder:text-graphite-400 focus:border-violet focus:outline-none md:text-2xl"
          />
          <button type="submit" className="label bg-offwhite px-6 py-4 text-obsidian transition-colors hover:bg-lime">
            Search now
          </button>
        </form>
        <p className="mt-5 max-w-2xl text-sm text-graphite-300">
          Today this is keyword search across events, cities and experiences. The concierge — budget, dates, who you’re
          going with — is being built and isn’t live yet.
        </p>
      </div>
    </section>
  );
}
