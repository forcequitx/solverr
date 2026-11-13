"use client";

import { type RefObject, useEffect, useEffectEvent } from "react";

type PopoverRefs = { root: RefObject<HTMLElement | null>; trigger: RefObject<HTMLElement | null>; panel: RefObject<HTMLElement | null> };

/** Popover behavior while `open`: focus moves to `initialFocus(panel)` or the panel; a press outside `root` or Escape calls `onClose`.
    On close, focus inside the panel goes back to `trigger`. */
export function usePopoverDismiss(open: boolean, { root, trigger, panel }: PopoverRefs, onClose: () => void, initialFocus?: (panel: HTMLElement) => HTMLElement | null | undefined): void {
  const close = useEffectEvent(onClose);
  const focusIn = useEffectEvent((popover: HTMLElement) => (initialFocus?.(popover) ?? popover).focus());
  useEffect(() => {
    if (!open) return;
    const opener = trigger.current;
    const popover = panel.current;
    if (popover) focusIn(popover);
    /** Runs in the capture phase and marks Escape handled, so a drawer around the popover stays open (useModalFocus skips it). */
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) close();
    };
    document.addEventListener("keydown", onKey, { capture: true });
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey, { capture: true });
      document.removeEventListener("pointerdown", onPointer);
      if (popover?.contains(document.activeElement)) opener?.focus();
    };
  }, [open, root, trigger, panel]);
}
