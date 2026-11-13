"use client";

import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_MARGIN, CHART_PROPS, ChartFrame, GRID_PROPS, usdDomain, useChartAnimation, X_AXIS_PROPS, Y_AXIS_PROPS } from "@/components/dashboard/charts/chart-frame";
import { ChartTooltip } from "@/components/dashboard/charts/chart-tooltip";
import { formatUsd, formatUsdCompact } from "@/lib/format";
import type { TransferBucket } from "@/lib/merchants/transfer-stats";

export const SENT_SERIES = [
  { key: "payoutsUsd", name: "Payouts", color: "var(--chart-2)" },
  { key: "refundsUsd", name: "Refunds", color: "var(--chart-4)" },
  { key: "withdrawalsUsd", name: "Earn withdrawals", color: "var(--chart-3)" },
] as const;

/** Value sent per bucket, stacked by kind: payouts, refunds and Earn withdrawals. */
export function SentBars({ buckets, label, emptyText }: { buckets: TransferBucket[]; label: string; emptyText: string }) {
  const empty = buckets.every((bucket) => bucket.payoutsUsd + bucket.refundsUsd + bucket.withdrawalsUsd === 0);
  const animate = useChartAnimation();
  const radius = buckets.length > 12 ? 2 : 4;

  return (
    <ChartFrame label={label} emptyText={empty ? emptyText : null}>
      <BarChart data={buckets} {...CHART_PROPS} margin={CHART_MARGIN} barCategoryGap={buckets.length > 12 ? "18%" : "30%"}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis {...X_AXIS_PROPS} />
        <YAxis {...Y_AXIS_PROPS} tickFormatter={formatUsdCompact} domain={usdDomain(empty)} />
        {empty ? null : (
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={(props) => (
              <ChartTooltip {...props} title={(point) => String(point.title)} rows={(point) => SENT_SERIES.map((series) => ({ name: series.name, value: formatUsd(Number(point[series.key])), color: series.color }))} />
            )}
          />
        )}
        {SENT_SERIES.map((series, index) => (
          <Bar
            key={series.key}
            dataKey={series.key}
            stackId="sent"
            fill={series.color}
            stroke="var(--surface)"
            strokeWidth={1}
            radius={radius}
            maxBarSize={36}
            isAnimationActive={animate}
            animationBegin={index * 120}
            animationDuration={600}
          />
        ))}
      </BarChart>
    </ChartFrame>
  );
}
