import { useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

const CHART_HEIGHT = 208;
const AXIS_TICK = { fill: "var(--muted)", fontSize: 12 };

/** Root props of every dashboard chart; Recharts' focusable keyboard layer stays off because `ChartFrame` names the chart for screen readers. */
export const CHART_PROPS = { responsive: true, style: { width: "100%", height: CHART_HEIGHT }, accessibilityLayer: false } as const;
export const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 };
export const GRID_PROPS = { vertical: false, stroke: "var(--border)", strokeDasharray: "4 4" } as const;
export const X_AXIS_PROPS = { dataKey: "label", tickLine: false, axisLine: false, tick: AXIS_TICK, interval: "preserveStartEnd", minTickGap: 28, tickMargin: 8 } as const;
export const Y_AXIS_PROPS = { width: 44, tickLine: false, axisLine: false, tick: AXIS_TICK } as const;

/** Y-axis range of a dollar chart: at least $0 to $1, so a day of a few cents still rises above the baseline with distinct ticks. */
export const usdDomain = (empty: boolean): [number, number | ((dataMax: number) => number)] => [0, empty ? 1 : (dataMax) => Math.max(dataMax, 1)];

/** Whether charts animate; false when the system asks for reduced motion. */
export const useChartAnimation = () => !useReducedMotion();

/** A chart as one image named by `label` for screen readers; `emptyText` shows over it when there is nothing to plot. */
export function ChartFrame({ label, emptyText = null, children }: { label: string; emptyText?: string | null; children: ReactNode }) {
  return (
    <figure role="img" aria-label={label} className="relative">
      {children}
      {emptyText ? <p className="pointer-events-none absolute inset-0 grid place-items-center px-6 pb-6 text-center text-sm text-muted">{emptyText}</p> : null}
    </figure>
  );
}
