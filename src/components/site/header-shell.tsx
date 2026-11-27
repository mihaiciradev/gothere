"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, Suspense, useEffect, useState } from "react";
import { Wordmark } from "@/components/brand/wordmark";

const links = [
  { href: "/discover", label: "Discover" },
  { href: "/tickets", label: "My tickets" },
];

function NavLinks({ highlight }: { highlight: boolean }) {
  // usePathname is request data; it only runs inside the Suspense boundary below.
  const pathname = usePathname();
  return links.map((link) => {
    const active = highlight && (pathname === link.href || pathname.startsWith(`${link.href}/`));
    return (
      <Link
        key={link.href}
        href={link.href}
        aria-current={active ? "page" : undefined}
        className={`label transition-colors hover:text-offwhite ${active ? "text-offwhite" : "text-graphite-300"}`}
      >
        {link.label}
      </Link>
    );
  });
}

function StaticNavLinks() {
  return links.map((link) => (
    <Link key={link.href} href={link.href} className="label text-graphite-300 transition-colors hover:text-offwhite">
      {link.label}
    </Link>
  ));
}

/**
 * Fixed header: transparent over imagery at the top of the page, solid once the page scrolls.
 * `session` slots are server-rendered (sign-in links or the signed-in menu).
 */
export function HeaderShell({ session, mobileSession }: { session: ReactNode; mobileSession: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.documentElement.style.overflow = open ? "hidden" : "";
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const solid = scrolled || open;

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-[background-color,border-color] duration-300 ${
        solid ? "border-b hairline bg-obsidian/85 backdrop-blur-md" : "border-b border-transparent scrim-top"
      }`}
    >
      <div className="container-edge flex h-16 items-center justify-between gap-6">
        <Link href="/" className="text-2xl text-offwhite" aria-label="gothere home" onClick={() => setOpen(false)}>
          <Wordmark />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-8 md:flex">
          <Suspense fallback={<StaticNavLinks />}>
            <NavLinks highlight />
          </Suspense>
        </nav>

        <div className="hidden md:block">{session}</div>

        <button
          type="button"
          className="label -mr-2 p-2 text-offwhite md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            id="mobile-menu"
            className="fixed inset-x-0 top-16 bottom-0 bg-obsidian md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <nav aria-label="Mobile" className="container-edge flex h-full flex-col justify-between pb-10 pt-8">
              <ul className="space-y-2">
                {[{ href: "/", label: "Home" }, ...links].map((link, i) => (
                  <motion.li
                    key={link.href}
                    initial={{ y: 24, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.04 * i, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <Link
                      href={link.href}
                      onClick={() => setOpen(false)}
                      className="font-display text-5xl font-semibold tracking-tight text-offwhite"
                    >
                      {link.label}
                    </Link>
                  </motion.li>
                ))}
              </ul>
              <div onClick={() => setOpen(false)}>{mobileSession}</div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
