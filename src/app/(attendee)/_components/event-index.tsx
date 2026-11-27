"use client";

import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { AvailabilityTag } from "@/components/ui/availability-tag";

export type IndexRow = {
  slug: string;
  title: string;
  category: string;
  city: string;
  venueName: string;
  stamp: { day: string; month: string; year: string };
  dateLabel: string;
  priceLabel: string | null;
  availability: "available" | "limited" | "sold_out" | "not_on_sale";
  heroImageUrl: string | null;
  experienceCount: number;
};

/**
 * Editorial event index: typographic rows instead of a card grid. On devices with a fine pointer, the
 * hovered row's photograph follows the cursor. Every row is a plain link; nothing depends on hover.
 */
export function EventIndex({ rows }: { rows: IndexRow[] }) {
  const [active, setActive] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 260, damping: 30 });
  const sy = useSpring(y, { stiffness: 260, damping: 30 });
  const activeRow = rows.find((r) => r.slug === active);

  return (
    <div
      className="relative"
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return;
        x.set(e.clientX);
        y.set(e.clientY);
      }}
      onPointerLeave={() => setActive(null)}
    >
      <ol className="border-t hairline">
        {rows.map((row) => (
          <li key={row.slug} className="border-b hairline">
            <Link
              href={`/events/${row.slug}`}
              onPointerEnter={(e) => e.pointerType === "mouse" && setActive(row.slug)}
              onFocus={() => setActive(null)}
              className="group grid grid-cols-[4.5rem_1fr] items-baseline gap-x-4 gap-y-2 py-6 transition-colors md:grid-cols-[7rem_1fr_14rem_9rem] md:gap-x-8 md:py-8"
            >
              <span className="tabular font-mono text-graphite-400 md:row-span-1">
                <span className="block font-display text-3xl font-medium leading-none tracking-tight text-offwhite md:text-4xl">
                  {row.stamp.day}
                </span>
                <span className="label mt-1 block">{row.stamp.month} {row.stamp.year}</span>
              </span>

              <span className="min-w-0">
                <span className="block font-display text-[clamp(1.75rem,4.6vw,4rem)] font-semibold leading-[0.95] tracking-[-0.035em] text-offwhite transition-colors duration-300 group-hover:text-lime">
                  {row.title}
                </span>
                <span className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 label text-graphite-400">
                  <span>{row.category}</span>
                  <span>{row.dateLabel}</span>
                  {row.experienceCount > 0 && (
                    <span>
                      {row.experienceCount} experience{row.experienceCount > 1 ? "s" : ""}
                    </span>
                  )}
                </span>
              </span>

              <span className="col-start-2 text-sm text-graphite-300 md:col-start-auto">
                <span className="block text-offwhite">{row.city}</span>
                {row.venueName}
              </span>

              <span className="col-start-2 flex items-center justify-between gap-4 md:col-start-auto md:flex-col md:items-end md:justify-start">
                <AvailabilityTag status={row.availability} />
                {row.priceLabel && <span className="tabular text-sm text-offwhite">from {row.priceLabel}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ol>

      <AnimatePresence>
        {!reduce && activeRow?.heroImageUrl && (
          <motion.div
            key={activeRow.slug}
            aria-hidden
            className="pointer-events-none fixed top-0 left-0 z-40 hidden aspect-[4/5] w-[18rem] overflow-hidden md:block"
            style={{ x: sx, y: sy, translateX: "24px", translateY: "-50%" }}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <Image src={activeRow.heroImageUrl} alt="" fill sizes="288px" className="object-cover" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
