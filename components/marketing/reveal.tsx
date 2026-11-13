"use client";

import * as m from "motion/react-m";
import type { ReactNode } from "react";
import { EASE_OUT, REDUCED_MOTION_SHOWN } from "@/components/ui/motion";

const HIDDEN = { opacity: 0, y: 36, filter: "blur(10px)" };
const SHOWN = { opacity: 1, y: 0, filter: "blur(0px)" };

/** Content that rises and sharpens into view the first time it scrolls in; `delay` staggers siblings. With reduced motion it shows at once. */
export function Reveal({ delay = 0, className, children }: { delay?: number; className?: string; children: ReactNode }) {
  return (
    <m.div
      initial={HIDDEN}
      whileInView={SHOWN}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.9, ease: EASE_OUT, delay }}
      className={`${className ?? ""} ${REDUCED_MOTION_SHOWN}`}
    >
      {children}
    </m.div>
  );
}
