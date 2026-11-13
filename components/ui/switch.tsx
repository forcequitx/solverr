import { FOCUS_RING } from "@/components/ui/focus-ring";

/** On/off switch with a sliding knob; `label` is its accessible name. On touch screens an invisible margin around it makes a 44px target. */
export function Switch({
  checked,
  onChange,
  label,
  title,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-200 pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5 ${FOCUS_RING} disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${checked ? "bg-accent" : "bg-muted/75"}`}
    >
      <span
        aria-hidden
        className={`size-5 rounded-full bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.2)] transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`}
      />
    </button>
  );
}
