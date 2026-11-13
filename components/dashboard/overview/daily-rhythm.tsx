import type { Heatmap } from "@/lib/merchants/stats";

const DOT = 10;
const GAP = 3;
const PITCH = DOT + GAP;
const HEAT_COLORS = ["var(--heat-0)", "var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)", "var(--heat-5)"];
const WEEKDAY_LABELS = [
  { row: 0, label: "Sun" },
  { row: 2, label: "Tue" },
  { row: 4, label: "Thu" },
  { row: 6, label: "Sat" },
];

const percent = (value: number, of: number) => `${(value / of) * 100}%`;

/** Dot grid of paid payments per day, one column per week, scaled to the width of its box; on phones it keeps legible dots
    and scrolls sideways, opening on the newest weeks (a reversed row starts scrolled to its right end). */
function PaidHeatmap({ heatmap }: { heatmap: Heatmap }) {
  const width = heatmap.weeks.length * PITCH - GAP;
  const height = 7 * PITCH - GAP;

  return (
    <div className="flex flex-row-reverse [scrollbar-width:none] max-md:overflow-x-auto">
      <div className="flex flex-1 flex-col gap-1.5 max-md:min-w-[480px] max-md:pt-1 max-md:pr-3">
        <div className="flex gap-2">
          <div aria-hidden className="relative w-7 shrink-0 text-xs leading-none text-muted">
            {WEEKDAY_LABELS.map((entry) => (
              <span key={entry.row} className="absolute left-0 -translate-y-1/2" style={{ top: percent(entry.row * PITCH + DOT / 2, height) }}>
                {entry.label}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${heatmap.total} paid payments in the last ${heatmap.weeks.length} weeks`} className="block h-auto w-full">
              {heatmap.weeks.map((week, column) =>
                week.map((day, row) =>
                  day ? (
                    <circle key={`${column}-${row}`} cx={column * PITCH + DOT / 2} cy={row * PITCH + DOT / 2} r={DOT / 2} fill={HEAT_COLORS[day.level]}>
                      <title>{day.title}</title>
                    </circle>
                  ) : null,
                ),
              )}
            </svg>
          </div>
        </div>
        <div aria-hidden className="relative ml-9 h-3 text-xs leading-none text-muted">
          {heatmap.months.map((month) => (
            <span key={month.column} className="absolute top-0" style={{ left: percent(month.column * PITCH, width) }}>
              {month.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Bordered box with the year of daily paid payments and a Quiet-to-Busy legend. */
export function DailyRhythm({ heatmap }: { heatmap: Heatmap }) {
  return (
    <div className="flex flex-col gap-4 rounded-[16px] border border-line p-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <p className="text-base font-semibold">Daily rhythm</p>
          <p className="text-meta text-muted">Paid payments across the last year</p>
        </div>
        <div aria-hidden className="flex items-center gap-1.5 text-xs text-muted">
          Quiet
          {HEAT_COLORS.map((color) => (
            <span key={color} className="size-2.5 rounded-full" style={{ background: color }} />
          ))}
          Busy
        </div>
      </div>
      <PaidHeatmap heatmap={heatmap} />
    </div>
  );
}
