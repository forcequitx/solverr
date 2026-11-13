"use client";

import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_MARGIN, CHART_PROPS, ChartFrame, GRID_PROPS, useChartAnimation, X_AXIS_PROPS, Y_AXIS_PROPS } from "@/components/dashboard/charts/chart-frame";
import { ChartTooltip } from "@/components/dashboard/charts/chart-tooltip";
import { SectionCard } from "@/components/dashboard/section-card";
import { HealthChip } from "@/components/dashboard/stats/chip";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { formatCount, share } from "@/lib/format";
import type { DeliveryHealth } from "@/lib/merchants/webhook-stats";

const HEALTHY_PERCENT = 95;
const WATCH_PERCENT = 80;

const SERIES = [
  { key: "delivered", name: "Delivered", color: "var(--chart-1)" },
  { key: "failed", name: "Failed", color: "var(--danger)" },
  { key: "pending", name: "Pending", color: "var(--chart-muted)" },
] as const;

/** Delivered share of finished webhook deliveries and a stacked bar per day of delivered, failed and pending events. */
export function DeliveryHealthCard({ health, days }: { health: DeliveryHealth; days: number }) {
  const animate = useChartAnimation();
  const finished = health.delivered + health.failed;
  const percent = share(health.delivered, finished);
  const empty = finished + health.pending === 0;

  return (
    <SectionCard icon="activity" title="Delivery health" description={`Webhook events created in the last ${days} days.`}>
      <div className="flex items-center gap-2">
        {finished > 0 ? <AnimatedNumber value={percent} format="percent" suffix=" delivered" className="font-heading text-3xl font-semibold tracking-tight" /> : <span className="font-heading text-3xl font-semibold tracking-tight">—</span>}
        <HealthChip finished={finished} percent={percent} healthy={HEALTHY_PERCENT} watch={WATCH_PERCENT} />
      </div>

      <ChartFrame
        label={`Over the last ${days} days, ${health.delivered} webhook events were delivered, ${health.failed} failed and ${health.pending} are pending.`}
        emptyText={empty ? "Deliveries appear here after Solverr sends the first webhook event." : null}
      >
        <BarChart data={health.days} {...CHART_PROPS} margin={CHART_MARGIN} barCategoryGap="22%">
          <CartesianGrid {...GRID_PROPS} />
          <XAxis {...X_AXIS_PROPS} />
          <YAxis {...Y_AXIS_PROPS} allowDecimals={false} domain={[0, empty ? 1 : "auto"]} />
          {empty ? null : (
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={(props) => <ChartTooltip {...props} title={(point) => String(point.title)} rows={(point) => SERIES.map((series) => ({ name: series.name, value: formatCount(point[series.key]), color: series.color }))} />}
            />
          )}
          {SERIES.map((series, index) => (
            <Bar
              key={series.key}
              dataKey={series.key}
              stackId="status"
              fill={series.color}
              stroke="var(--surface)"
              strokeWidth={1}
              radius={3}
              maxBarSize={28}
              isAnimationActive={animate}
              animationBegin={index * 120}
              animationDuration={550}
            />
          ))}
        </BarChart>
      </ChartFrame>

      <dl className="mt-auto grid grid-cols-3 gap-px overflow-hidden rounded-[14px] border border-line bg-line">
        {SERIES.map((series) => (
          <div key={series.key} className="flex min-w-0 flex-col-reverse gap-0.5 bg-surface px-2.5 py-3 sm:px-4">
            <dt className="flex items-center gap-1 text-meta text-muted sm:gap-1.5">
              <span aria-hidden className="size-2 shrink-0 rounded-[3px] sm:size-2.5" style={{ background: series.color }} />
              <span className="truncate">{series.name}</span>
            </dt>
            <dd className="text-lg font-semibold tracking-tight">
              <AnimatedNumber value={health[series.key]} />
            </dd>
          </div>
        ))}
      </dl>
    </SectionCard>
  );
}
