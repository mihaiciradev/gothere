"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/control", label: "Health", exact: true },
  { href: "/control/incidents", label: "Incidents" },
  { href: "/control/transactions", label: "Transactions" },
  { href: "/control/ai", label: "AI usage" },
];

/** Section navigation. No colour transition: active and idle states differ in background (see ADR-0011 notes). */
export function ControlNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Control Center" className="flex gap-1 overflow-x-auto no-scrollbar">
      {links.map((link) => {
        const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap px-3 py-1.5 font-mono text-xs uppercase tracking-wider ${active ? "bg-graphite-100 text-graphite-950" : "text-graphite-300 hover:text-graphite-100"}`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
