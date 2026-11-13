"use client";

import { AnimatePresence, MotionConfig } from "motion/react";
import * as m from "motion/react-m";
import { type ReactNode, useEffect, useEffectEvent, useRef } from "react";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon } from "@/components/ui/icon";
import { BACKDROP_MOTION, DRAWER_MOTION } from "@/components/ui/motion";
import { useModalFocus } from "@/components/ui/use-modal-focus";

/** Tailwind's `md` breakpoint, from which the drawer is hidden. */
const WIDE_QUERY = "(min-width: 48rem)";

const CLOSE_BUTTON =
  `grid size-8 place-items-center rounded-[8px] text-muted pointer-coarse:size-11 hover:bg-surface-2 ${FOCUS_RING}`;

/** Phone drawer that slides in from the left over a backdrop, as a modal dialog named `label`.
    `header` sits beside the close button; without it the close button floats over the top right of `children`. */
export function Drawer({
  open,
  onClose,
  label,
  header,
  className = "",
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  header?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = useEffectEvent(onClose);
  useModalFocus(open, panel, closeButton, onClose);
  /** The drawer is hidden from the `md` width up, so a window widened while it is open closes it and frees the page. */
  useEffect(() => {
    if (!open) return;
    const wide = window.matchMedia(WIDE_QUERY);
    if (wide.matches) close();
    const onChange = (event: MediaQueryListEvent) => event.matches && close();
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, [open]);

  const closeControl = (
    <button ref={closeButton} type="button" onClick={onClose} aria-label="Close menu" className={header ? CLOSE_BUTTON : `absolute right-3 top-3.5 ${CLOSE_BUTTON}`}>
      <Icon name="close" className="size-4" />
    </button>
  );

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {open ? (
          /** `data-lenis-prevent` keeps the landing page's smooth scrolling from moving the page behind an open drawer. */
          <div className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true" aria-label={label} data-lenis-prevent>
            {/** A pointer shortcut only: keyboard and screen reader users close with the close button or Escape. */}
            <m.div {...BACKDROP_MOTION} aria-hidden="true" className="absolute inset-0 bg-scrim" onClick={onClose} />
            <m.div
              ref={panel}
              {...DRAWER_MOTION}
              className={`relative m-3 flex w-[min(300px,calc(100vw-1.5rem))] flex-col gap-4 rounded-card border border-line bg-surface p-3 shadow-[0_12px_40px_-12px_rgb(0_0_0/0.35)] ${className}`}
            >
              {header ? (
                <div className="flex items-center justify-between gap-2 px-1">
                  {header}
                  {closeControl}
                </div>
              ) : (
                closeControl
              )}
              {children}
            </m.div>
          </div>
        ) : null}
      </AnimatePresence>
    </MotionConfig>
  );
}
