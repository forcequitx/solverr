"use client";

import { type RefObject, useEffect, useEffectEvent } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab and Shift+Tab wrap around inside `root`, skipping anything inside an inert subtree. */
function keepFocusInside(event: KeyboardEvent, root: HTMLElement | null) {
  if (!root) return;
  const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => !item.closest("[inert]"));
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

/** Modal behavior while `open`: focus moves to `initial`, Tab stays inside `panel`, Escape calls `onClose`, the page behind does not scroll.
    On close, focus returns to the element that had it before. */
export function useModalFocus(open: boolean, panel: RefObject<HTMLElement | null>, initial: RefObject<HTMLElement | null>, onClose: () => void): void {
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    initial.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        /** A popover inside the panel already handled this Escape (usePopoverDismiss), so only the popover closes. */
        if (event.defaultPrevented) return;
        event.preventDefault();
        close();
      } else if (event.key === "Tab") keepFocusInside(event, panel.current);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      opener?.focus({ preventScroll: true });
    };
  }, [open, panel, initial]);
}
