"use client";

import { LazyMotion } from "motion/react";
import type { ReactNode } from "react";

const loadFeatures = () => import("@/components/ui/motion-features").then((mod) => mod.default);

/** Lets the app's `m` elements animate once Motion's features have loaded; `strict` refuses the full `motion` element, which would put
    every feature back into each page's first download. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      {children}
    </LazyMotion>
  );
}
