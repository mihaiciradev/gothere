"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const links = [
  { href: "/organizer", label: "Overview", exact: true },
  { href: "/organizer/intelligence", label: "Intelligence" },
  { href: "/organizer/approvals", label: "Approvals" },
];

/** Section navigation. Keeps the selected organization (`?org=`) across sections. Rendered inside Suspense. */
export function OrganizerNav() {
  const pathname = usePathname();
  const org = useSearchParams().get("org");
  return (
    <nav aria-label="Organizer" className="flex gap-1 overflow-x-auto no-scrollbar">
      {links.map((link) => {
        const active = link.exact ? pathname === link.href || pathname.startsWith("/organizer/events") : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={org ? `${link.href}?org=${encodeURIComponent(org)}` : link.href}
            aria-current={active ? "page" : undefined}
            // No colour transition: fading between the active (light-on-dark) and idle (dark-on-light) states
            // passes through unreadable light-on-light frames.
            className={`whitespace-nowrap px-3 py-2 text-sm ${active ? "bg-obsidian text-offwhite" : "text-graphite-500 hover:bg-graphite-100 hover:text-obsidian"}`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
