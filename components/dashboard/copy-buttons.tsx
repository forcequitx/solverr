"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import type { ComponentProps } from "react";
import { ICON_ACTION } from "@/components/dashboard/list/list-styles";
import { ActionButton } from "@/components/ui/action-button";
import { ActionError } from "@/components/ui/action-error";
import { Icon } from "@/components/ui/icon";
import { useClipboard } from "@/components/ui/use-clipboard";

const ICON_SWAP = { initial: { opacity: 0, scale: 0.6 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.6 }, transition: { duration: 0.15 } };
const COPY_BLOCKED = "Your browser blocked the clipboard. Select the text and copy it by hand.";

/** Icon button copying `text` that shows a check, or a red alert when the clipboard is blocked; with `path`, a site path is copied as a full URL. */
export function CopyIconButton({ text, ariaLabel, path = false }: { text: string; ariaLabel: string; path?: boolean }) {
  const { copied, failed: blocked, copy } = useClipboard();
  const state = copied ? "check" : blocked ? "alert" : "copy";
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={blocked ? COPY_BLOCKED : ariaLabel}
      className={ICON_ACTION}
      onClick={() => copy(path ? `${window.location.origin}${text}` : text)}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <m.span key={state} {...ICON_SWAP} className={copied ? "text-success" : blocked ? "text-danger" : undefined}>
          <Icon name={state} className="size-4" />
        </m.span>
      </AnimatePresence>
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied" : blocked ? COPY_BLOCKED : ""}
      </span>
    </button>
  );
}

/** Button with its own text that copies `text`: it turns green with "Copied" for a moment, or red with the reason under it when the browser blocks the clipboard. */
export function CopyAction({ text, children, className, ...props }: Omit<ComponentProps<typeof ActionButton>, "onClick" | "done" | "doneLabel" | "failed"> & { text: string }) {
  const { copied, failed: blocked, copy } = useClipboard();
  return (
    <span className={`flex flex-col items-start gap-1.5 ${className ?? ""}`}>
      <ActionButton {...props} done={copied} doneLabel="Copied" failed={blocked} onClick={() => copy(text)}>
        {children}
      </ActionButton>
      <ActionError message={blocked ? COPY_BLOCKED : null} />
    </span>
  );
}
