"use client";

import * as m from "motion/react-m";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icon";

type Tone = "success" | "info" | "warn" | "danger";

const TONES: Record<Tone, { box: string; icon: IconName }> = {
  success: { box: "bg-success-bg text-success", icon: "check" },
  info: { box: "bg-info-bg text-info", icon: "activity" },
  warn: { box: "bg-warn-bg text-warn", icon: "alert" },
  danger: { box: "bg-danger-bg text-danger", icon: "alert" },
};

/** Tinted box with an icon that pops in, for the result or the state of an action such as a completed transfer. */
export function OutcomeBanner({ tone, title, children }: { tone: Tone; title: string; children?: ReactNode }) {
  const { box, icon } = TONES[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`flex items-start gap-3 rounded-[14px] px-4 py-3 ${box}`}>
      <m.span
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1, transition: { type: "spring", stiffness: 420, damping: 22 } }}
        className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-surface/70"
      >
        <Icon name={icon} className="size-3.5" />
      </m.span>
      <div className="min-w-0 text-body">
        <p className="font-semibold">{title}</p>
        {children ? <div className="mt-0.5 break-words text-meta opacity-90">{children}</div> : null}
      </div>
    </div>
  );
}
