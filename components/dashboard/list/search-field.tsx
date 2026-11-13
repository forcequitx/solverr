import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon } from "@/components/ui/icon";

/** Pill-shaped search input that filters a list as the merchant types; full width on phones. */
export function SearchField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="relative flex min-w-0 basis-full sm:basis-auto">
      <span className="sr-only">{label}</span>
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        className={`h-9 w-full rounded-full border border-line bg-surface pl-9 pr-3 text-field placeholder:text-muted pointer-coarse:h-11 sm:w-56 ${FOCUS_RING}`}
      />
    </label>
  );
}
