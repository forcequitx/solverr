"use client";

import * as m from "motion/react-m";
import { Icon, type IconName } from "@/components/ui/icon";
import { EASE_OUT } from "@/components/ui/motion";

type TimelineState = "done" | "current" | "upcoming" | "warn" | "failed";

export type TimelineStep = { id: string; label: string; detail?: string; time?: string; state: TimelineState };

const STEP_DELAY = 0.12;

const DOTS: Record<TimelineState, { className: string; icon?: IconName }> = {
  done: { className: "bg-success-bg text-success", icon: "check" },
  current: { className: "bg-accent/15 text-accent-text" },
  upcoming: { className: "border border-line bg-surface text-muted" },
  warn: { className: "bg-warn-bg text-warn", icon: "alert" },
  failed: { className: "bg-danger-bg text-danger", icon: "close" },
};

function StepDot({ state }: { state: TimelineState }) {
  const dot = DOTS[state];
  return (
    <span className={`relative z-10 grid size-7 shrink-0 place-items-center rounded-full transition-colors duration-300 motion-reduce:transition-none ${dot.className}`}>
      {dot.icon ? <Icon name={dot.icon} className="size-3.5" /> : null}
      {state === "current" ? (
        <>
          <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-accent/25 motion-reduce:animate-none" />
          <span aria-hidden className="size-2 rounded-full bg-accent" />
        </>
      ) : null}
      {state === "upcoming" ? <span aria-hidden className="size-1.5 rounded-full bg-line" /> : null}
    </span>
  );
}

/** Vertical list of steps that fade in one after another; the line below a finished step fills in as it is reached. */
export function StatusTimeline({ steps, label }: { steps: TimelineStep[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <m.li
            key={step.id}
            aria-current={step.state === "current" ? "step" : undefined}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE_OUT, delay: index * STEP_DELAY } }}
            className="relative flex gap-3.5 pb-5 last:pb-0"
          >
            {last ? null : (
              <span aria-hidden className="absolute left-[13px] top-7 bottom-0 w-0.5 overflow-hidden rounded-full bg-line">
                <m.span
                  className="block h-full w-full origin-top bg-success"
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: step.state === "done" ? 1 : 0, transition: { duration: 0.35, ease: EASE_OUT, delay: index * STEP_DELAY + 0.15 } }}
                />
              </span>
            )}
            <StepDot state={step.state} />
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className={`text-body font-medium ${step.state === "upcoming" ? "text-muted" : "text-fg"}`}>{step.label}</p>
                {step.time ? <p className="text-meta tabular-nums text-muted">{step.time}</p> : null}
              </div>
              {step.detail ? <p className={`mt-0.5 break-words text-meta ${step.state === "failed" ? "text-danger" : step.state === "warn" ? "text-warn" : "text-muted"}`}>{step.detail}</p> : null}
            </div>
          </m.li>
        );
      })}
    </ol>
  );
}
