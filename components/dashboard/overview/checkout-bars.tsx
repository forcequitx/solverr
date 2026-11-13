"use client";

import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_MARGIN, CHART_PROPS, ChartFrame, GRID_PROPS, useChartAnimation, X_AXIS_PROPS, Y_AXIS_PROPS } from "@/components/dashboard/charts/chart-frame";
import { ChartTooltip } from "@/components/dashboard/charts/chart-tooltip";
import { formatCount } from "@/lib/format";
import type { Bucket } from "@/lib/merchants/stats";

/** Gray bar of checkouts created per bucket with the paid ones in lime over it; separate x axes make the two overlap, not stand side by side. */
export function CheckoutBars({ buckets, label, emptyText }: { buckets: Bucket[]; label: string; emptyText: string }) {
  const empty = buckets.every((bucket) => bucket.checkouts === 0);
  const animate = useChartAnimation();
  const radius = buckets.length > 12 ? 3 : 6;
  const bar = { radius: [radius, radius, radius, radius] as [number, number, number, number], maxBarSize: 36 };

  return (
    <ChartFrame label={label} emptyText={empty ? emptyText : null}>
      <BarChart data={buckets} {...CHART_PROPS} margin={CHART_MARGIN} barCategoryGap={buckets.length > 12 ? "18%" : "30%"}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis xAxisId="created" {...X_AXIS_PROPS} />
        <XAxis xAxisId="paid" dataKey="label" hide />
        <YAxis {...Y_AXIS_PROPS} allowDecimals={false} domain={[0, empty ? 1 : "auto"]} />
        {empty ? null : (
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={(props) => (
              <ChartTooltip
                {...props}
                title={(point) => String(point.title)}
                rows={(point) => [
                  { name: "Checkouts created", value: formatCount(point.checkouts), color: "var(--chart-muted)" },
                  { name: "Paid", value: formatCount(point.checkoutsPaid), color: "var(--chart-1)" },
                ]}
              />
            )}
          />
        )}
        <Bar xAxisId="created" dataKey="checkouts" fill="var(--chart-muted)" {...bar} isAnimationActive={animate} animationDuration={550} />
        <Bar xAxisId="paid" dataKey="checkoutsPaid" fill="var(--chart-1)" {...bar} isAnimationActive={animate} animationBegin={150} animationDuration={650} />
      </BarChart>
    </ChartFrame>
  );
}
