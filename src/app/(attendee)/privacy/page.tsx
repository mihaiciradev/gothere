import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy notice" };

/** Static privacy notice for the prototype. Kept factual: it describes what the code actually does. */
export default function PrivacyPage() {
  return (
    <article className="container-edge max-w-3xl pt-28 pb-12 md:pt-36">
      <p className="label text-graphite-400">Privacy notice · prototype</p>
      <h1 className="mt-3 font-display text-display-lg font-semibold">Your data on gothere</h1>
      <p className="mt-6 text-lg text-graphite-300">
        gothere is a demonstration prototype. All events are fictional and payments are simulated: no money moves and no
        card details are ever requested. Please don’t enter personal information beyond an email address you control.
      </p>

      <Section title="What we store">
        <li>
          <strong>Account:</strong> your name, email and a password hash (scrypt). Passwords are never stored or logged in
          plain text.
        </li>
        <li>
          <strong>Activity:</strong> your reservations, simulated payments, orders and tickets, and an append-only audit trail
          of changes made by organisers and the system.
        </li>
        <li>
          <strong>Interest signals:</strong> waitlist requests, views of sold-out sessions and searches that found nothing.
          They are stored under a keyed one-way hash, not your account or visitor id, and are used only to show organisers
          unmet demand in aggregate.
        </li>
        <li>
          <strong>Operational logs:</strong> request ids, error codes and timings. Secrets and credentials are redacted
          before anything is logged.
        </li>
      </Section>

      <Section title="Cookies">
        <li>
          <strong>Session</strong> (<code>gothere.*</code>): keeps you signed in. HttpOnly, 7 days.
        </li>
        <li>
          <strong>Visitor</strong> (<code>gt_vid</code>): a random id that lets us count distinct interest and limit anonymous
          use. HttpOnly, 1 year, never shared.
        </li>
        <li>
          <strong>Preview access</strong> (<code>gt_access</code>): proves you entered the preview password. HttpOnly, 7 days.
        </li>
        <li>No advertising, analytics or third-party tracking cookies.</li>
      </Section>

      <Section title="AI features">
        <li>
          The concierge uses AI only for <strong>signed-in</strong> visitors, when AI is enabled. Your message (at most 500
          characters) is then sent to Anthropic’s Claude API to choose among our real listings; your account details are
          not sent. Answers are labelled “AI picks” or “Plain search” so you always know which one you got.
        </li>
        <li>Organiser tools send only aggregate figures (sales, counts of interest) to the AI, never attendee identities.</li>
      </Section>

      <Section title="Where it runs">
        <li>Application hosting: Vercel. Database: Neon PostgreSQL in the EU (Frankfurt).</li>
        <li>Event photography is loaded from Unsplash’s image CDN, which can see your IP address when images load.</li>
      </Section>

      <Section title="Your choices">
        <li>
          You can stop using the prototype at any time. To have your demo account and its data deleted, ask the person who
          gave you access to the preview.
        </li>
      </Section>

      <p className="mt-12 text-sm text-graphite-400">
        Last updated 28 November 2026. <Link href="/" className="underline hover:text-lime">Back to gothere</Link>
      </p>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 border-t hairline pt-6">
      <h2 className="font-display text-2xl font-semibold tracking-tight">{title}</h2>
      <ul className="mt-4 list-disc space-y-3 pl-5 text-graphite-300">{children}</ul>
    </section>
  );
}
