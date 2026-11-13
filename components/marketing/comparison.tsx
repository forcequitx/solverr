"use client";

import * as m from "motion/react-m";
import { LogoMark, WORDMARK } from "@/components/brand/logo";
import { Glow } from "@/components/marketing/glow";
import { Reveal } from "@/components/marketing/reveal";
import { Icon } from "@/components/ui/icon";
import { EASE_OUT, REDUCED_MOTION_SHOWN } from "@/components/ui/motion";

type Rows = readonly (readonly [theirs: string, ours: string])[];

const ITEM_VIEW = { once: true, amount: 0.8 } as const;

function rowMotion(index: number, from: number) {
  return {
    initial: { opacity: 0, x: from },
    whileInView: { opacity: 1, x: 0 },
    viewport: ITEM_VIEW,
    transition: { duration: 0.5, ease: EASE_OUT, delay: 0.15 + index * 0.07 },
  };
}

/** Phone layout: a white gateways card with a blue Solverr card lifted over its bottom edge. */
function StackedComparison({ rows }: { rows: Rows }) {
  return (
    <div className="mt-14 md:hidden">
      <Reveal className="rounded-[22px] border border-line bg-surface pb-8">
        <p className="border-b border-line px-5 pb-4 pt-6 font-heading text-xl font-semibold">Custodial gateways</p>
        <ul className="px-5">
          {rows.map(([theirs], index) => (
            <m.li key={theirs} {...rowMotion(index, -10)} className={`flex items-start gap-3 border-b border-dashed border-line py-3 text-muted last:border-0 ${REDUCED_MOTION_SHOWN}`}>
              <Icon name="chevronRight" className="mt-[5px] size-3.5 shrink-0" />
              {theirs}
            </m.li>
          ))}
        </ul>
      </Reveal>
      <Reveal delay={0.1} className="relative -mt-6 overflow-hidden rounded-[22px] bg-[linear-gradient(140deg,var(--accent),color-mix(in_srgb,var(--accent)_65%,var(--chart-3)))] text-accent-ink shadow-[0_18px_40px_-18px_color-mix(in_srgb,var(--accent)_70%,transparent)]">
        <Glow className="-right-28 -top-28 size-[240px] animate-glow-breathe opacity-40" />
        <p className={`relative border-b border-white/20 px-5 pb-4 pt-6 text-xl ${WORDMARK}`}>Solverr</p>
        <ul className="relative px-5 pb-2">
          {rows.map(([, ours], index) => (
            <m.li key={ours} {...rowMotion(index, 10)} className={`flex items-start gap-3 border-b border-dashed border-white/25 py-3 font-medium last:border-0 ${REDUCED_MOTION_SHOWN}`}>
              <Icon name="chevronRight" className="mt-[5px] size-3.5 shrink-0" />
              {ours}
            </m.li>
          ))}
        </ul>
      </Reveal>
    </div>
  );
}

const LIST = "relative flex flex-1 flex-col gap-1 overflow-hidden rounded-[24px] border border-line bg-surface p-6";

/** Wide layout: two columns, gateway items struck through as they appear and Solverr items checked off. */
function ColumnComparison({ rows }: { rows: Rows }) {
  return (
    <div className="mx-auto mt-14 hidden max-w-[920px] grid-cols-2 gap-6 md:grid">
      <Reveal className="flex flex-col gap-5">
        <p className="text-center font-heading text-2xl font-medium text-muted">Custodial gateways</p>
        <ul className={LIST}>
          {rows.map(([theirs], index) => (
            <m.li key={theirs} {...rowMotion(index, -12)} className={`flex items-start gap-3 py-2 text-muted ${REDUCED_MOTION_SHOWN}`}>
              <Icon name="close" className="mt-1 size-4 shrink-0" />
              <span className="relative">
                {theirs}
                <m.span
                  aria-hidden="true"
                  initial={{ scaleX: 0 }}
                  whileInView={{ scaleX: 1 }}
                  viewport={ITEM_VIEW}
                  transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.7 + index * 0.08 }}
                  className={`absolute inset-x-0 top-1/2 h-px origin-left bg-muted/70 ${REDUCED_MOTION_SHOWN}`}
                />
              </span>
            </m.li>
          ))}
        </ul>
      </Reveal>
      <Reveal delay={0.12} className="flex flex-col gap-5">
        <p className={`flex items-center justify-center gap-2 text-2xl ${WORDMARK}`}>
          <LogoMark className="size-7" />
          Solverr
        </p>
        <ul className={LIST}>
          <Glow className="-right-36 -top-36 size-[280px] animate-glow-breathe opacity-60" />
          {rows.map(([, ours], index) => (
            <m.li key={ours} {...rowMotion(index, 12)} className={`relative flex items-start gap-3 py-2 font-medium ${REDUCED_MOTION_SHOWN}`}>
              <m.span
                initial={{ scale: 0, rotate: -45 }}
                whileInView={{ scale: 1, rotate: 0 }}
                viewport={ITEM_VIEW}
                transition={{ type: "spring", stiffness: 400, damping: 15, delay: 0.5 + index * 0.08 }}
                className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent/15 text-accent-text ${REDUCED_MOTION_SHOWN}`}
              >
                <Icon name="check" className="size-3" />
              </m.span>
              {ours}
            </m.li>
          ))}
        </ul>
      </Reveal>
    </div>
  );
}

/** What custodial gateways do next to what Solverr does: stacked cards on phones, two columns from `md`. */
export function ComparisonLists({ rows }: { rows: Rows }) {
  return (
    <>
      <StackedComparison rows={rows} />
      <ColumnComparison rows={rows} />
    </>
  );
}
