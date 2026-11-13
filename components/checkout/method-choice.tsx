"use client";

import type { KeyboardEvent } from "react";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon, type IconName } from "@/components/ui/icon";

export type PayMethod = "wallet" | "manual";

const METHODS = ["wallet", "manual"] as const;
const ICONS: Record<PayMethod, IconName> = { wallet: "wallet", manual: "send" };
const STEP_KEYS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** The two ways to pay as a radio group: only the chosen option (or the first) is in the tab order; arrows, Home and End move the choice. */
export function MethodChoice({
  value,
  label,
  labels,
  disabled = false,
  onChange,
}: {
  value: PayMethod | null;
  label: string;
  labels: Record<PayMethod, string>;
  /** Locks the choice, for example while a wallet request waits for the customer. */
  disabled?: boolean;
  onChange: (method: PayMethod) => void;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const from = buttons.indexOf(event.target as HTMLButtonElement);
    const step = STEP_KEYS[event.key];
    const target = event.key === "Home" ? 0 : event.key === "End" ? METHODS.length - 1 : step && from >= 0 ? (from + step + METHODS.length) % METHODS.length : -1;
    if (disabled || target < 0) return;
    event.preventDefault();
    onChange(METHODS[target]);
    buttons[target]?.focus();
  }

  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className="grid w-full max-w-[460px] grid-cols-2 gap-3">
      {METHODS.map((method, index) => {
        const on = value === method;
        return (
          <button
            key={method}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (value === null && index === 0) ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(method)}
            className={`flex h-28 flex-col items-center justify-center gap-3 rounded-[20px] border-[1.5px] text-center font-heading text-[14.5px] leading-tight font-semibold transition-[border-color,background-color,translate,box-shadow,opacity] duration-200 hover:-translate-y-0.5 ${FOCUS_RING} disabled:pointer-events-none disabled:opacity-60 @[35rem]:h-[132px] @[35rem]:rounded-3xl @[35rem]:text-[15.5px] ${
              on ? "border-accent bg-accent/7 shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_10%,transparent)]" : "border-line bg-surface hover:border-accent/45"
            }`}
          >
            <span
              className={`grid size-[50px] place-items-center rounded-full transition-colors duration-200 @[35rem]:size-[58px] ${on ? "bg-accent text-accent-ink" : "bg-surface-2 text-fg"}`}
            >
              <Icon name={ICONS[method]} className="size-[25px]" />
            </span>
            {labels[method]}
          </button>
        );
      })}
    </div>
  );
}
