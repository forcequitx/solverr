"use client";

import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon } from "@/components/ui/icon";
import { useDarkMode } from "@/components/ui/use-dark-mode";

/** Dark mode switch; the choice is saved in this browser and applied before the next page paints. */
export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const [dark, toggle] = useDarkMode();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      onClick={toggle}
      title={collapsed ? "Dark mode" : undefined}
      className={`flex h-10 w-full items-center pointer-coarse:h-11 gap-3 rounded-[12px] text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg ${FOCUS_RING} ${collapsed ? "justify-center" : "px-3"}`}
    >
      <Icon name="moon" className="size-[18px] shrink-0" />
      {collapsed ? (
        <span className="sr-only">Dark mode</span>
      ) : (
        <>
          <span className="flex-1 text-left">Dark mode</span>
          {/** Styled by the dark variant rather than state, so the switch is already in place on the first paint. */}
          <span className="relative h-5 w-9 rounded-full bg-muted/75 transition-colors dark:bg-accent">
            <span className="absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none dark:translate-x-4" />
          </span>
        </>
      )}
    </button>
  );
}
