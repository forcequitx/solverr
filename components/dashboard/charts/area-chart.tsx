"use client";

import { useId } from "react";
import { Area, CartesianGrid, AreaChart as RechartsAreaChart, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_MARGIN, CHART_PROPS, ChartFrame, GRID_PROPS, usdDomain, useChartAnimation, X_AXIS_PROPS, Y_AXIS_PROPS } from "@/components/dashboard/charts/chart-frame";
import { ChartTooltip } from "@/components/dashboard/charts/chart-tooltip";

type ChartPoint = { label: string; title: string; value: number };

/** Lime area chart with hover details; shows `emptyText` over a flat baseline when every value is zero. */
export function AreaChart({
  points,
  label,
  seriesName,
  formatTick,
  formatValue,
  emptyText,
}: {
  points: ChartPoint[];
  label: string;
  seriesName: string;
  formatTick: (value: number) => string;
  formatValue: (value: number) => string;
  emptyText: string;
}) {
  const gradient = `area-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const animate = useChartAnimation();
  const empty = points.every((point) => point.value === 0);

  return (
    <ChartFrame label={label} emptyText={empty ? emptyText : null}>
      <RechartsAreaChart data={points} {...CHART_PROPS} margin={CHART_MARGIN}>
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.32} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis {...X_AXIS_PROPS} />
        <YAxis {...Y_AXIS_PROPS} tickFormatter={formatTick} domain={usdDomain(empty)} />
        {empty ? null : (
          <Tooltip
            cursor={{ stroke: "var(--chart-1)", strokeDasharray: "4 4" }}
            content={(props) => (
              <ChartTooltip {...props} title={(point) => String(point.title)} rows={(point) => [{ name: seriesName, value: formatValue(Number(point.value)), color: "var(--chart-1)" }]} />
            )}
          />
        )}
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill={`url(#${gradient})`}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)", fill: "var(--chart-1)" }}
          isAnimationActive={animate}
          animationDuration={750}
          animationEasing="ease-out"
        />
      </RechartsAreaChart>
    </ChartFrame>
  );
}
