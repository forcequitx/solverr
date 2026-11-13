"use client";

import { useScroll, useSpring, type MotionValue } from "motion/react";
import * as m from "motion/react-m";
import { useRef, type RefObject } from "react";
import { Reveal } from "@/components/marketing/reveal";
import { Icon, type IconName } from "@/components/ui/icon";
import { REDUCED_MOTION_SHOWN } from "@/components/ui/motion";

type Step = { icon: IconName; title: string; text: string };
type ScrollOffset = NonNullable<Parameters<typeof useScroll>[0]>["offset"];

const LINE_GRADIENT = "from-[var(--accent)] via-[var(--chart-3)] to-[var(--logo-bottom)]";

/** Scroll progress through `target`, smoothed; lines using it carry REDUCED_MOTION_SHOWN, so reduced motion shows them fully drawn. */
function useDrawProgress(target: RefObject<HTMLElement | null>, offset: ScrollOffset): MotionValue<number> {
  const { scrollYProgress } = useScroll({ target, offset });
  return useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 });
}

/** Phone connector from one step's icon down to the next step's icon. */
function Connector() {
  const line = useRef<HTMLDivElement>(null);
  const drawn = useDrawProgress(line, ["start 0.7", "end 0.6"]);
  return (
    <div ref={line} aria-hidden="true" className="absolute left-8 top-16 h-[calc(100%-1.5rem)] w-px -translate-x-1/2 bg-line md:hidden">
      <m.div style={{ scaleY: drawn }} className={`size-full origin-top bg-linear-to-b ${LINE_GRADIENT} ${REDUCED_MOTION_SHOWN}`} />
    </div>
  );
}

/** Three steps joined by a line that draws itself on scroll: a row on wide screens, a timeline on phones. */
export function StepsTrack({ steps }: { steps: readonly Step[] }) {
  const row = useRef<HTMLDivElement>(null);
  const drawn = useDrawProgress(row, ["start 0.85", "center 0.5"]);
  return (
    <div ref={row} className="relative mx-auto mt-14 grid max-w-[1000px] gap-10 md:grid-cols-3 md:gap-8">
      <div aria-hidden="true" className="absolute left-[16.67%] right-[16.67%] top-8 hidden h-px bg-line md:block">
        <m.div style={{ scaleX: drawn }} className={`h-full origin-left bg-linear-to-r ${LINE_GRADIENT} ${REDUCED_MOTION_SHOWN}`} />
      </div>
      {steps.map((step, index) => (
        <Reveal key={step.title} delay={index * 0.15} className="relative flex items-start gap-5 text-left md:flex-col md:items-center md:text-center">
          {index < steps.length - 1 ? <Connector /> : null}
          <span className="relative grid size-16 shrink-0 place-items-center rounded-[18px] border border-line bg-surface text-accent-text shadow-card">
            <Icon name={step.icon} className="size-7" />
          </span>
          <div className="pt-1 md:pt-0">
            <h3 className="text-xl font-semibold tracking-tight md:mt-6">{step.title}</h3>
            <p className="mt-2 text-muted md:mx-auto md:max-w-[280px]">{step.text}</p>
          </div>
        </Reveal>
      ))}
    </div>
  );
}
