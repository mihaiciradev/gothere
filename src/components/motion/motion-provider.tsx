"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * Honour the operating-system reduced-motion setting everywhere: transform and layout animations are
 * skipped (elements jump to their final state) while server and client markup stay identical.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
