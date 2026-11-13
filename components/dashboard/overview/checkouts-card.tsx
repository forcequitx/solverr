"use client";

import { useState } from "react";
import { CheckoutBars } from "@/components/dashboard/overview/checkout-bars";
import { ChangeChip } from "@/components/dashboard/stats/chip";
import { PERIOD_LABELS, PeriodTabs } from "@/components/dashboard/stats/period-tabs";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Card } from "@/components/ui/card";
import { IconBox } from "@/components/ui/icon-box";
import type { Period } from "@/lib/merchants/stat-periods";
import type { PeriodStats } from "@/lib/merchants/stats";

/** Checkouts created per bucket against how many of them are paid. */
export function CheckoutsCard({ periods }: { periods: Record<Period, PeriodStats> }) {
  const [period, setPeriod] = useState<Period>("30d");
  const stats = periods[period];

  return (
    <Card className="flex min-w-0 flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <IconBox name="payments" tint="blue" />
          <div>
            <h2 className="text-meta text-muted">Checkouts vs paid</h2>
            <p className="mt-1 flex items-center gap-2">
              <AnimatedNumber value={stats.checkoutsPaid} suffix=" paid" className="font-heading text-3xl font-semibold tracking-tight" />
              <ChangeChip current={stats.checkoutsPaid} previous={stats.previousCheckoutsPaid} />
            </p>
          </div>
        </div>
        <PeriodTabs value={period} onChange={setPeriod} label="Checkouts period" />
      </div>
      <CheckoutBars
        key={period}
        buckets={stats.buckets}
        label={`Over the last ${PERIOD_LABELS[period]}, ${stats.checkoutsPaid} of ${stats.checkouts} checkouts are paid.`}
        emptyText="Checkouts appear here after the first one is created."
      />
      <div aria-hidden className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-[var(--chart-muted)]" />
          Checkouts created
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-[var(--chart-1)]" />
          Paid
        </span>
      </div>
    </Card>
  );
}
