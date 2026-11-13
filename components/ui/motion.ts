/** Shared Motion presets so popovers, drawers, lists and step screens move the same way everywhere. */

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Menus and popovers: a short lift and scale in, a quicker fade out. */
export const POPOVER_MOTION = {
  initial: { opacity: 0, y: -6, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.18, ease: EASE_OUT } },
  exit: { opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } },
};

/** Menus that open upwards, such as the account menu at the bottom of the sidebar. */
export const POPOVER_UP_MOTION = {
  initial: { opacity: 0, y: 6, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.18, ease: EASE_OUT } },
  exit: { opacity: 0, y: 4, scale: 0.98, transition: { duration: 0.12 } },
};

/** Phone drawer sliding in from the left over a fading backdrop. */
export const DRAWER_MOTION = {
  initial: { x: "-104%" },
  animate: { x: 0, transition: { duration: 0.28, ease: EASE_OUT } },
  exit: { x: "-104%", transition: { duration: 0.2 } },
};

/** A block that opens in place, such as case details or a newly shown secret: height and fade in, a quicker close. */
export const EXPAND_MOTION = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1, transition: { duration: 0.24, ease: EASE_OUT } },
  exit: { height: 0, opacity: 0, transition: { duration: 0.16 } },
};

export const BACKDROP_MOTION = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.16 } },
};

/** A screen that sharpens into view while the previous one blurs away. Use inside `AnimatePresence mode="popLayout"`. */
export const BLUR_SWAP_MOTION = {
  initial: { opacity: 0, filter: "blur(8px)" },
  animate: { opacity: 1, filter: "blur(0px)", transition: { duration: 0.4, ease: EASE_OUT } },
  exit: { opacity: 0, filter: "blur(5px)", transition: { duration: 0.18 } },
};

/** A step screen dropping into place while the previous one shrinks away beneath it. Use inside `AnimatePresence mode="popLayout"`. */
export const STEP_DROP_MOTION = {
  initial: { opacity: 0, y: -14 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease: EASE_OUT, delay: 0.06 } },
  exit: { opacity: 0, y: 10, scale: 0.94, transition: { duration: 0.26 } },
};

/** Shows an element in its final state under reduced motion: Motion's `reducedMotion="user"` skips only movement, not fades and blurs.
    `!important` wins over Motion's inline styles without a hydration mismatch. */
export const REDUCED_MOTION_SHOWN = "motion-reduce:!opacity-100 motion-reduce:![filter:none] motion-reduce:!transform-none";

/** Whether the visitor asked for reduced motion; for animations started from code. Browser only. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** List items fading up one after another by `index`; removed items leave at once, so a page or filter change never mixes old and new rows. */
export function listItemMotion(index: number) {
  return {
    layout: "position" as const,
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE_OUT, delay: Math.min(index, 12) * 0.03 } },
    exit: { opacity: 0, transition: { duration: 0 } },
  };
}
