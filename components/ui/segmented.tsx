import type { KeyboardEvent, ReactNode } from "react";

type Role = "radiogroup" | "tablist" | "group";
type Look = keyof typeof LOOKS;

const STEP_KEYS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** `soft`: gray track, white highlight. `strong`: bordered white track, dark highlight, for page-level tabs. */
const LOOKS = {
  soft: {
    track: "h-8 rounded-control bg-surface-2 p-0.5 text-sm font-medium pointer-coarse:h-11",
    highlight: "inset-y-0.5 left-0.5 rounded-[8px] bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.1)]",
    inset: "4px",
    item: "rounded-[8px] px-2.5",
    on: "text-fg",
  },
  strong: {
    track: "h-12 rounded-[14px] border border-line bg-surface p-1 text-sm font-semibold pointer-coarse:h-[54px]",
    highlight: "inset-y-1 left-1 rounded-[10px] bg-fg",
    inset: "8px",
    item: "rounded-[10px] px-3",
    on: "text-bg",
  },
} as const;

function trackProps(look: Look, count: number, className: string) {
  return { className: `relative inline-grid shrink-0 ${LOOKS[look].track} ${className}`, style: { gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` } };
}

function itemClass(look: Look, selected: boolean): string {
  const style = LOOKS[look];
  return `relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap ${style.item} transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
    selected ? style.on : "text-muted hover:text-fg"
  }`;
}

/** The highlight behind the chosen option, moved by whole option widths. */
function Highlight({ look, count, index }: { look: Look; count: number; index: number }) {
  const style = LOOKS[look];
  return (
    <span
      aria-hidden
      className={`absolute ${style.highlight} transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none`}
      style={{ width: `calc((100% - ${style.inset}) / ${count})`, transform: `translateX(${index * 100}%)` }}
    />
  );
}

/** Segmented switch with equal-width options and a sliding highlight; as a radio group or tab list, arrows, Home and End move the choice.
    With `idPrefix`, each tab gets the id `{idPrefix}-tab-{value}`; the selected tab also points `aria-controls` at `{idPrefix}-panel-{value}`. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  role = "group",
  look = "soft",
  idPrefix,
  className = "",
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  role?: Role;
  look?: Look;
  idPrefix?: string;
  className?: string;
}) {
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const itemRole = role === "radiogroup" ? "radio" : role === "tablist" ? "tab" : undefined;
  const tabIds = itemRole === "tab" && idPrefix ? idPrefix : undefined;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!itemRole) return;
    const step = STEP_KEYS[event.key];
    const target = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : step ? (index + step + options.length) % options.length : -1;
    if (target < 0) return;
    event.preventDefault();
    onChange(options[target].value);
    event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[target]?.focus();
  }

  return (
    <div role={role} aria-label={label} onKeyDown={onKeyDown} {...trackProps(look, options.length, className)}>
      <Highlight look={look} count={options.length} index={index} />
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role={itemRole}
            id={tabIds ? `${tabIds}-tab-${option.value}` : undefined}
            aria-controls={tabIds && selected ? `${tabIds}-panel-${option.value}` : undefined}
            aria-checked={itemRole === "radio" ? selected : undefined}
            aria-selected={itemRole === "tab" ? selected : undefined}
            aria-pressed={itemRole ? undefined : selected}
            tabIndex={itemRole ? (selected ? 0 : -1) : undefined}
            onClick={() => onChange(option.value)}
            className={itemClass(look, selected)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
