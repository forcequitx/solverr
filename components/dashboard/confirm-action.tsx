"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useRef, useState } from "react";
import { ActionError } from "@/components/ui/action-error";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon } from "@/components/ui/icon";

const SWAP_MOTION = { initial: { opacity: 0, x: 6 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -6 }, transition: { duration: 0.16 } };
const SMALL_BUTTON = `inline-flex h-8 items-center gap-1.5 rounded-control px-2.5 text-sm font-medium pointer-coarse:h-11 transition-colors motion-reduce:transition-none disabled:opacity-50 ${FOCUS_RING}`;

/** Destructive action that asks once more (confirm button and "Keep"); on `error` the confirm button turns red with "Try again" and the reason. */
export function ConfirmAction({
  label,
  confirmLabel,
  ariaLabel,
  onConfirm,
  pending = false,
  error = null,
}: {
  label: string;
  confirmLabel: string;
  /** Names what the action applies to, such as "Revoke sk_live_…ab12". */
  ariaLabel: string;
  onConfirm: () => void;
  pending?: boolean;
  error?: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  /** Whether the confirm button was pressed since the buttons last opened, so an earlier failure does not show again on reopening. */
  const [attempted, setAttempted] = useState(false);
  const failed = attempted && error !== null && !pending;
  /** Set when a press swaps the buttons, so the button that appears takes the focus the pressed one had. */
  const focusOnSwap = useRef(false);
  const takeFocus = (element: HTMLButtonElement | null) => {
    if (!element || !focusOnSwap.current) return;
    focusOnSwap.current = false;
    element.focus();
  };
  const swap = (next: boolean) => {
    focusOnSwap.current = true;
    setAttempted(false);
    setConfirming(next);
  };
  return (
    <div className="ml-auto flex shrink-0 flex-col items-end gap-1">
      <div className="flex h-8 items-center justify-end pointer-coarse:h-11">
        <AnimatePresence mode="wait" initial={false}>
          {confirming ? (
            <m.div key="confirm" {...SWAP_MOTION} className="flex items-center gap-1">
              <button
                ref={takeFocus}
                type="button"
                disabled={pending}
                className={`${SMALL_BUTTON} ${failed ? "bg-danger-solid text-white" : "bg-danger-bg text-danger"}`}
                onClick={() => {
                  setAttempted(true);
                  onConfirm();
                }}
                aria-label={`Confirm: ${ariaLabel}`}
              >
                {failed ? <Icon name="retry" className="size-3.5" /> : null}
                {failed ? "Try again" : confirmLabel}
              </button>
              <button type="button" disabled={pending} className={`${SMALL_BUTTON} text-muted hover:bg-surface-2 hover:text-fg`} onClick={() => swap(false)}>
                Keep
              </button>
            </m.div>
          ) : (
            <m.button
              key="start"
              ref={takeFocus}
              {...SWAP_MOTION}
              type="button"
              className={`${SMALL_BUTTON} text-danger hover:bg-danger-bg`}
              onClick={() => swap(true)}
              aria-label={ariaLabel}
            >
              {label}
            </m.button>
          )}
        </AnimatePresence>
      </div>
      {confirming && failed ? <ActionError message={error} className="max-w-64 text-right" /> : null}
    </div>
  );
}
