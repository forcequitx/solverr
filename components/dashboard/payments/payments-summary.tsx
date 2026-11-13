"use client";

import { useState } from "react";
import { StatusDonut, type DonutSlice } from "@/components/dashboard/payments/status-donut";
import { ChangeChip } from "@/components/dashboard/stats/chip";
import { KpiCard } from "@/components/dashboard/stats/kpi-card";
import { PERIOD_LABELS, PeriodTabs } from "@/components/dashboard/stats/period-tabs";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Card } from "@/components/ui/card";
import { CardHeading } from "@/components/ui/card-heading";
import { share } from "@/lib/format";
import type { Period } from "@/lib/merchants/stat-periods";
import type { PeriodStats } from "@/lib/merchants/stats";

/** Outcome donut for the payments created in the chosen period, with four stat cards that follow the same period. */
export function PaymentsSummary({ periods }: { periods: Record<Period, PeriodStats> }) {
  const [period, setPeriod] = useState<Period>("30d");
  const stats = periods[period];
  const span = PERIOD_LABELS[period];
  const slices: DonutSlice[] = [
    { name: "Paid", value: stats.checkoutsPaid, color: "var(--chart-1)" },
    { name: "Open", value: stats.checkouts - stats.finished, color: "var(--chart-2)" },
    { name: "Returned", value: stats.refunds, color: "var(--chart-4)" },
    { name: "Expired or failed", value: stats.expiredOrFailed, color: "var(--chart-muted)" },
  ];

  return (
    <div className="grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <Card className="flex min-w-0 flex-col gap-5 p-5 sm:p-6">
        <CardHeading
          icon="activity"
          title="Payment outcomes"
          description="Where the payments created in this period stand now."
          aside={<PeriodTabs value={period} onChange={setPeriod} label="Payment outcomes period" />}
        />

        <div className="grid flex-1 items-center gap-5 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
          <StatusDonut
            key={period}
            slices={slices}
            label={`Of ${stats.checkouts} payments created in the last ${span}: ${slices.map((slice) => `${slice.value} ${slice.name.toLowerCase()}`).join(", ")}.`}
            emptyText="No payments were created in this period."
          />
          <ul aria-hidden className="flex flex-col divide-y divide-line">
            {slices.map((slice) => (
              <li key={slice.name} className="flex items-center justify-between gap-3 py-2.5 text-meta first:pt-0 last:pb-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: slice.color }} />
                  <span className="truncate">{slice.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 tabular-nums">
                  <AnimatedNumber value={slice.value} className="font-semibold" />
                  <span className="w-10 rounded-md bg-surface-2 py-0.5 text-center text-xs font-medium text-muted">
                    <AnimatedNumber value={share(slice.value, stats.checkouts)} format="percent" />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <div className="grid auto-rows-fr grid-cols-2 gap-4 sm:gap-5">
        <KpiCard icon="payments" tint="blue" label={`Payments created · ${span}`} value={stats.checkouts} />
        <KpiCard icon="trendUp" tint="lime" label={`Paid revenue · ${span}`} value={stats.revenueUsd} format="usd" chip={<ChangeChip current={stats.revenueUsd} previous={stats.previousRevenueUsd} />} />
        <KpiCard icon="check" tint="lime" label={`Paid · ${span}`} value={stats.checkoutsPaid} chip={<ChangeChip current={stats.checkoutsPaid} previous={stats.previousCheckoutsPaid} />} />
        <KpiCard icon="transfers" tint="blue" label={`Returned · ${span}`} value={stats.refunds} />
      </div>
    </div>
  );
}
