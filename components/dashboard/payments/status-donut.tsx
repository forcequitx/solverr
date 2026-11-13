"use client";

import { Pie, PieChart, Tooltip } from "recharts";
import { CHART_PROPS, ChartFrame, useChartAnimation } from "@/components/dashboard/charts/chart-frame";
import { ChartTooltip } from "@/components/dashboard/charts/chart-tooltip";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { formatCount } from "@/lib/format";

export type DonutSlice = { name: string; value: number; color: string };

/** Donut of payment counts by outcome with the total in the middle; a gray ring and `emptyText` when there are none. */
export function StatusDonut({ slices, label, emptyText }: { slices: DonutSlice[]; label: string; emptyText: string }) {
  const animate = useChartAnimation();
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const empty = total === 0;
  const data = empty ? [{ name: "None", value: 1, fill: "var(--surface-2)" }] : slices.filter((slice) => slice.value > 0).map((slice) => ({ name: slice.name, value: slice.value, fill: slice.color }));

  return (
    <ChartFrame label={label}>
      <PieChart {...CHART_PROPS}>
        {empty ? null : (
          <Tooltip
            content={(props) => <ChartTooltip {...props} title={(point) => String(point.name)} rows={(point) => [{ name: "Payments", value: formatCount(point.value), color: String(point.fill) }]} />}
          />
        )}
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="72%"
          outerRadius="100%"
          paddingAngle={data.length > 1 ? 2 : 0}
          cornerRadius={6}
          startAngle={90}
          endAngle={-270}
          stroke="none"
          isAnimationActive={animate}
          animationDuration={750}
          animationEasing="ease-out"
        />
      </PieChart>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        {empty ? (
          <p className="max-w-36 text-meta text-muted">{emptyText}</p>
        ) : (
          <>
            <AnimatedNumber value={total} className="font-heading text-2xl font-semibold tracking-tight" />
            <span className="text-xs text-muted">{total === 1 ? "payment" : "payments"}</span>
          </>
        )}
      </div>
    </ChartFrame>
  );
}
