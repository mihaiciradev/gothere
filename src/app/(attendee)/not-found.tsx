import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container-edge flex min-h-[70svh] flex-col justify-end pb-16 pt-40">
      <p className="label text-graphite-400">404 · Not found</p>
      <h1 className="mt-4 font-display text-display-lg font-semibold">This page isn’t on the lineup.</h1>
      <p className="mt-4 max-w-md text-graphite-300">
        It may have moved, or the link may be private to another account.
      </p>
      <div className="mt-10 flex flex-wrap gap-4">
        <Link href="/discover" className="inline-flex items-center gap-6 bg-lime px-6 py-4 font-medium text-obsidian hover:bg-offwhite">
          Discover events <span aria-hidden>→</span>
        </Link>
        <Link href="/tickets" className="inline-flex items-center border hairline px-6 py-4 hover:border-offwhite">
          My tickets
        </Link>
      </div>
    </div>
  );
}
