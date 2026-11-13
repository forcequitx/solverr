"use client";

import { useState } from "react";
import { AreaChart } from "@/components/dashboard/charts/area-chart";
import { ChangeChip } from "@/components/dashboard/stats/chip";
import { PERIOD_LABELS, PeriodTabs } from "@/components/dashboard/stats/period-tabs";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Card } from "@/components/ui/card";
import { formatUsd, formatUsdCompact } from "@/lib/format";
import type { Period } from "@/lib/merchants/stat-periods";
import type { PeriodStats } from "@/lib/merchants/stats";

/** Paid revenue in USD for the chosen period, compared with the period before it. */
export function RevenueCard({ periods }: { periods: Record<Period, PeriodStats> }) {
  const [period, setPeriod] = useState<Period>("30d");
  const stats = periods[period];
  const unit = period === "12m" ? "month" : "day";

  return (
    <Card className="flex min-w-0 flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-meta text-muted">Paid revenue</h2>
          <p className="mt-1 flex items-center gap-2">
            <AnimatedNumber value={stats.revenueUsd} format="usd" className="font-heading text-3xl font-semibold tracking-tight" />
            <ChangeChip current={stats.revenueUsd} previous={stats.previousRevenueUsd} />
          </p>
        </div>
        <PeriodTabs value={period} onChange={setPeriod} label="Paid revenue period" />
      </div>
      <AreaChart
        key={period}
        points={stats.buckets.map((bucket) => ({ label: bucket.label, title: bucket.title, value: bucket.revenueUsd }))}
        label={`Paid revenue per ${unit} over the last ${PERIOD_LABELS[period]}: ${formatUsd(stats.revenueUsd)} in total.`}
        seriesName="Paid revenue"
        formatTick={formatUsdCompact}
        formatValue={formatUsd}
        emptyText="Revenue appears here after the first paid payment."
      />
    </Card>
  );
}
