"use client";

import { motion } from "motion/react";

/**
 * Display title revealed line by line from behind a mask. Only transform animates, so text occupies its
 * final box from the first paint (no layout shift). Reduced motion is handled by MotionProvider; the
 * server and client render identical markup.
 */
export function RevealTitle({
  lines,
  className = "",
  as: Tag = "h1",
  delay = 0.1,
}: {
  lines: string[];
  className?: string;
  as?: "h1" | "h2";
  delay?: number;
}) {
  return (
    <Tag className={className}>
      <span className="sr-only">{lines.join(" ")}</span>
      {lines.map((line, i) => (
        <span key={i} aria-hidden className="block overflow-hidden pb-[0.06em]">
          <motion.span
            className="block"
            initial={{ y: "105%" }}
            animate={{ y: "0%" }}
            transition={{ duration: 0.9, delay: delay + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </Tag>
  );
}
