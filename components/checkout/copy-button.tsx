"use client";

import type { ComponentProps } from "react";
import { ActionButton } from "@/components/ui/action-button";
import { Icon } from "@/components/ui/icon";
import { useClipboard } from "@/components/ui/use-clipboard";
import { en } from "@/lib/i18n/messages/en";

/** Copies `value`: the button turns green with "Copied" for a moment, or red with "Could not copy" when the browser blocks the clipboard. */
export function CopyButton({
  value,
  label,
  variant = "secondary",
  className = "",
  "aria-label": ariaLabel,
}: { value: string; label: string } & Pick<ComponentProps<typeof ActionButton>, "variant" | "className" | "aria-label">) {
  const { copied, failed, copy } = useClipboard();
  const m = en.common;

  return (
    <>
      <ActionButton
        variant={variant}
        size="sm"
        className={className}
        aria-label={ariaLabel}
        done={copied}
        doneLabel={m.copied}
        failed={failed}
        failedLabel={m.copyFailed}
        onClick={() => copy(value)}
      >
        <Icon name="copy" className="size-4 shrink-0" />
        {label}
      </ActionButton>
      <span className="sr-only" aria-live="polite">
        {copied ? m.copied : failed ? m.copyFailed : ""}
      </span>
    </>
  );
}
