"use client";

import { type ReactNode, useCallback, useLayoutEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useFieldLabelId } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { useListbox } from "@/components/ui/use-listbox";

/** `tag` is a short note shown beside the label, such as RECOMMENDED. */
type SelectOption = { value: string; label: string; icon?: ReactNode; tag?: string };

/** The tag on the option the measured route data favors, in the payout network and coin pickers. */
export const RECOMMENDED = "Recommended";

/** A tag inside the inverted menu, in the same colors as the menu's check mark so it reads on both menu colors. */
function MenuTag({ children }: { children: ReactNode }) {
  return <span className="shrink-0 whitespace-nowrap rounded-full bg-current/15 px-2 py-0.5 text-xs font-semibold text-logo-bottom dark:text-success-solid">{children}</span>;
}

const TRIGGER = {
  md: "h-11 w-full gap-2.5 pr-1 text-field",
  sm: "h-9 gap-2 pr-1 text-sm font-medium pointer-coarse:h-11",
};
/** A leading icon sits closer to the field's rounded edge than text does. */
const TRIGGER_START = { md: { text: "pl-3.5", icon: "pl-2" }, sm: { text: "pl-3.5", icon: "pl-1.5" } };
const KNOB = { md: "size-[34px]", sm: "size-7 pointer-coarse:size-9" };
const SMALL_MENU_WIDTH = 280;
/** Space kept between the small menu and the screen edges, in total. */
const SMALL_MENU_GUTTER = 56;
const MENU = {
  /** The pointer sits over the knob, whose center is 21px from the trigger's right edge. */
  md: "inset-x-0 before:absolute before:-top-1.5 before:right-[15px] before:size-3 before:rotate-45 before:rounded-[2px] before:bg-fg",
  sm: "w-[min(280px,calc(100vw-3.5rem))]",
};

/** "Inverted" select: a rounded field with a round arrow knob opening a menu in opposite colors; options may carry a leading icon.
    Focus stays on the field: arrows move, Enter or Space picks, Escape closes, a typed letter jumps to the next option starting with it. */
export function SearchSelect({
  id,
  value,
  options,
  onChange,
  label,
  size = "md",
  disabled = false,
}: {
  id?: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  /** Accessible name when no visible label points at the field. */
  label?: string;
  size?: keyof typeof TRIGGER;
  disabled?: boolean;
}) {
  const { open, active, setActive, rootRef, triggerRef, optionId, toggle, choose, onKeyDown } = useListbox({
    items: options,
    value,
    valueOf: (option) => option.value,
    labelOf: (option) => option.label,
    onSelect: onChange,
  });
  const selected = options.find((option) => option.value === value);
  const listId = `${optionId(0)}-list`;
  /** A field label names the trigger through `htmlFor`; the list needs it by id. */
  const fieldLabelId = useFieldLabelId(id);

  /** The small menu opens toward the side with room. Measured on mount and resize too: the closed menu is only invisible and still takes room,
      so on the wrong side it widens the page. */
  const [alignEnd, setAlignEnd] = useState(false);
  const measure = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setAlignEnd(rect.left + Math.min(SMALL_MENU_WIDTH, window.innerWidth - SMALL_MENU_GUTTER) > window.innerWidth - SMALL_MENU_GUTTER / 2);
  }, [triggerRef]);
  useLayoutEffect(() => {
    if (size !== "sm") return;
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [size, measure]);

  return (
    <div ref={rootRef} data-open={open} className={`group/select relative min-w-0 ${size === "md" ? "w-full" : "inline-flex"}`}>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 && options[active] ? optionId(active) : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => {
          if (!open) measure();
          toggle();
        }}
        onKeyDown={(event) => {
          if (!open) measure();
          onKeyDown(event);
        }}
        /** Firefox clicks a button on Space keyup even after keydown was handled, which would close the menu Space just opened. */
        onKeyUp={(event) => {
          if (event.key === " ") event.preventDefault();
        }}
        className={`flex items-center rounded-full bg-surface-2 text-left text-fg transition-[background-color,box-shadow] duration-150 hover:bg-line/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60 group-data-[open=true]/select:ring-2 group-data-[open=true]/select:ring-fg/15 motion-reduce:transition-none ${TRIGGER[size]} ${TRIGGER_START[size][selected?.icon ? "icon" : "text"]}`}
      >
        {selected?.icon}
        <span className="min-w-0 flex-1 truncate">{selected?.label}</span>
        {selected?.tag ? <Badge tone="success">{selected.tag}</Badge> : null}
        <span className={`grid shrink-0 place-items-center rounded-full bg-fg text-bg ${KNOB[size]}`}>
          <Icon name="chevronDown" className="size-4 transition-transform duration-200 group-data-[open=true]/select:rotate-180 motion-reduce:transition-none" />
        </span>
      </button>

      <div
        inert={!open}
        className={`absolute top-full z-30 mt-2.5 rounded-2xl bg-fg text-bg shadow-[0_16px_44px_-12px_rgb(0_0_0/0.45)] ${MENU[size]} ${size === "sm" ? (alignEnd ? "right-0" : "left-0") : ""} invisible -translate-y-2 opacity-0 [transition:opacity_120ms,translate_120ms,visibility_0s_120ms] group-data-[open=true]/select:visible group-data-[open=true]/select:translate-y-0 group-data-[open=true]/select:opacity-100 group-data-[open=true]/select:[transition:opacity_200ms_cubic-bezier(0.22,1,0.36,1),translate_240ms_cubic-bezier(0.22,1,0.36,1),visibility_0s] motion-reduce:transition-none`}
      >
        {/** A closed list collapses once it has faded out, so it adds no scroll room below the field at the end of a page. */}
        <ul id={listId} role="listbox" aria-label={label} aria-labelledby={label ? undefined : fieldLabelId} className="relative max-h-[300px] overflow-y-auto p-1.5 [scrollbar-width:none] group-data-[open=false]/select:max-h-0 group-data-[open=false]/select:[transition:max-height_0s_120ms]">
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <li
                key={option.value}
                id={optionId(index)}
                role="option"
                aria-selected={isSelected}
                onPointerMove={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
                className={`flex min-h-10 cursor-pointer items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm pointer-coarse:min-h-11 ${index === active ? "bg-bg/15" : ""}`}
              >
                {option.icon}
                <span className={`min-w-0 flex-1 ${isSelected ? "font-semibold" : ""}`}>{option.label}</span>
                {option.tag ? <MenuTag>{option.tag}</MenuTag> : null}
                {isSelected ? <Icon name="check" className="size-4 shrink-0 text-logo-bottom dark:text-success-solid" /> : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
