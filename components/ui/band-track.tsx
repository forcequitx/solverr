/** State of one step on a band track: not started, current, finished, needs attention, or failed. */
export type TrackStepState = "todo" | "cur" | "done" | "warn" | "bad";

/** Dots on the accent band: white for steps that started, amber for a warning, red for a failure. */
const DOT_TONES: Record<TrackStepState, string> = {
  todo: "border-accent-ink/55 bg-accent",
  cur: "animate-dot-pulse border-accent-ink bg-accent-ink",
  done: "border-accent-ink bg-accent-ink",
  warn: "border-accent-ink bg-(--chart-4)",
  bad: "border-accent-ink bg-danger",
};

/** Steps as dots on a line across the accent band, filled up to the furthest started step. Steps not started use a hollow dot and lighter
    weight, never faded text, so every label keeps 4.5:1 on the band. `compactLabels` shows only the current label in narrow containers. */
export function BandTrack({
  steps,
  current,
  label,
  compactLabels = false,
  className = "",
}: {
  steps: { key: string; label: string; state: TrackStepState }[];
  current: number;
  label: string;
  compactLabels?: boolean;
  className?: string;
}) {
  const count = steps.length;
  /** The line runs from the middle of the first column to the middle of the last one. */
  const inset = 50 / count;
  const reached = steps.reduce((last, step, index) => (step.state !== "todo" ? index : last), -1);
  return (
    <ol className={`relative grid w-full ${className}`} style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }} aria-label={label}>
      <span aria-hidden="true" className="absolute top-[5px] h-0.5 rounded-full bg-accent-ink/25" style={{ left: `${inset}%`, right: `${inset}%` }} />
      <span
        aria-hidden="true"
        className="absolute top-[5px] h-0.5 rounded-full bg-accent-ink/80 transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{ left: `${inset}%`, width: `${(Math.max(reached, 0) / (count - 1)) * (100 - 2 * inset)}%` }}
      />
      {steps.map((step, index) => (
        <li
          key={step.key}
          aria-current={index === current ? "step" : undefined}
          className={`relative flex flex-col items-center gap-2 font-heading text-xs leading-tight @xl:gap-2.5 @xl:text-[12.5px] ${step.state === "todo" ? "font-medium" : "font-semibold"}`}
        >
          <span aria-hidden="true" className={`size-3 rounded-full border-2 transition-colors duration-500 ${DOT_TONES[step.state]}`} />
          <span className={compactLabels && index !== current ? "sr-only @xl:not-sr-only" : undefined}>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}
