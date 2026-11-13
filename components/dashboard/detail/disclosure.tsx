"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useId, useState, type ReactNode } from "react";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon } from "@/components/ui/icon";
import { EXPAND_MOTION } from "@/components/ui/motion";

/** Button that opens and closes a panel below it with a height animation. */
export function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1 rounded-control text-sm font-medium text-accent-text pointer-coarse:min-h-11 hover:underline ${FOCUS_RING}`}
      >
        {summary}
        <Icon name="chevronDown" className={`size-4 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <m.div id={panel} {...EXPAND_MOTION} className="overflow-hidden">
            <div className="pt-3">{children}</div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
