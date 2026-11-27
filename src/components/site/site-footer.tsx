import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";

export function SiteFooter() {
  return (
    <footer className="mt-32 border-t hairline">
      <div className="container-edge grid gap-12 py-16 md:grid-cols-12">
        <div className="md:col-span-6">
          <p className="max-w-sm text-lg text-graphite-300">
            Discovery, tickets and everything around the night — in one place.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 md:col-span-6 md:grid-cols-3">
          <div className="space-y-3">
            <p className="label text-graphite-400">Explore</p>
            <ul className="space-y-2 text-sm">
              <li><Link className="hover:text-lime" href="/discover">All events</Link></li>
              <li><Link className="hover:text-lime" href="/discover?category=festival">Festivals</Link></li>
              <li><Link className="hover:text-lime" href="/discover?category=club">Club nights</Link></li>
            </ul>
          </div>
          <div className="space-y-3">
            <p className="label text-graphite-400">Account</p>
            <ul className="space-y-2 text-sm">
              <li><Link className="hover:text-lime" href="/tickets">My tickets</Link></li>
              <li><Link className="hover:text-lime" href="/sign-in">Sign in</Link></li>
            </ul>
          </div>
          <div className="space-y-3">
            <p className="label text-graphite-400">Prototype</p>
            <p className="text-sm text-graphite-300">Fictional events. Payments are simulated; no money moves.</p>
          </div>
        </nav>
      </div>
      <div className="container-edge overflow-hidden pb-6">
        <Wordmark className="block text-[clamp(4rem,19vw,17rem)] leading-[0.8] text-offwhite/95" />
        <div className="mt-6 flex flex-wrap justify-between gap-2 label text-graphite-400">
          <span>EPS CTO challenge · gothere prototype</span>
          <span>Photography via Unsplash · credits on each page</span>
        </div>
      </div>
    </footer>
  );
}
