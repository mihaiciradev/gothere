export default function Home() {
  return (
    <main data-surface="attendee" className="relative flex flex-1 flex-col justify-between bg-bg px-6 py-8 text-fg sm:px-12 sm:py-12">
      <header className="flex items-center justify-between">
        <span className="font-display text-2xl font-semibold tracking-tight">
          gothere<span className="text-accent">.</span>
        </span>
        <span className="rounded-pill border border-border px-3 py-1 font-mono text-xs uppercase tracking-widest text-muted">
          Prototype · foundation build
        </span>
      </header>

      <section className="max-w-6xl py-24">
        <h1 className="font-display text-display-xl font-semibold">
          The next generation of <span className="text-accent">live experiences.</span>
        </h1>
        <p className="mt-8 max-w-xl text-lg text-muted">
          An AI-native event platform connecting attendees, organizers and engineering operations. Discovery,
          ticketing and organizer intelligence arrive in the next milestones.
        </p>
      </section>

      <footer className="font-mono text-xs text-muted">EPS CTO challenge · fictional data only</footer>
    </main>
  );
}
