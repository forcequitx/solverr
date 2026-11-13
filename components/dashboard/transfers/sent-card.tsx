"use client";

import { useState } from "react";
import { PERIOD_LABELS, PeriodTabs } from "@/components/dashboard/stats/period-tabs";
import { SENT_SERIES, SentBars } from "@/components/dashboard/transfers/sent-bars";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Card } from "@/components/ui/card";
import { CardHeading } from "@/components/ui/card-heading";
import { formatUsd } from "@/lib/format";
import type { Period } from "@/lib/merchants/stat-periods";
import type { TransferPeriod } from "@/lib/merchants/transfer-stats";

/** Completed refunds, payouts and Earn withdrawals per day or month for the chosen period, valued at current coin prices. */
export function SentCard({ periods }: { periods: Record<Period, TransferPeriod> }) {
  const [period, setPeriod] = useState<Period>("30d");
  const stats = periods[period];
  const unit = period === "12m" ? "month" : "day";

  return (
    <Card className="flex min-w-0 flex-col gap-5 p-5 sm:p-6">
      <CardHeading icon="transfers" title="Sent from your wallet" description="Completed transfers, valued at current coin prices." aside={<PeriodTabs value={period} onChange={setPeriod} label="Sent period" />} />
      <div>
        <AnimatedNumber value={stats.sentUsd} format="usd" className="font-heading text-3xl font-semibold tracking-tight" />
        <p className="text-meta text-muted">
          <AnimatedNumber value={stats.sent} suffix={stats.sent === 1 ? " transfer completed" : " transfers completed"} /> in the last {PERIOD_LABELS[period]}
        </p>
      </div>
      <SentBars
        key={period}
        buckets={stats.buckets}
        label={`Value sent per ${unit} over the last ${PERIOD_LABELS[period]}: ${formatUsd(stats.sentUsd)} in ${stats.sent} completed transfers.`}
        emptyText="Completed refunds and payouts appear here."
      />
      <div aria-hidden className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {SENT_SERIES.map((series) => (
          <span key={series.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px]" style={{ background: series.color }} />
            {series.name}
          </span>
        ))}
      </div>
    </Card>
  );
}
