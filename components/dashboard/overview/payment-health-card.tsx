"use client";

import { useState, type ReactNode } from "react";
import { HealthChip } from "@/components/dashboard/stats/chip";
import { PeriodTabs } from "@/components/dashboard/stats/period-tabs";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Card } from "@/components/ui/card";
import { CardHeading } from "@/components/ui/card-heading";
import { share } from "@/lib/format";
import type { Period } from "@/lib/merchants/stat-periods";
import type { PeriodStats } from "@/lib/merchants/stats";

const HEALTHY_PERCENT = 80;
const WATCH_PERCENT = 50;

/** Paid share of finished checkouts, checkout outcomes, and the daily rhythm box passed as `children`. */
export function PaymentHealthCard({ periods, children }: { periods: Record<Period, PeriodStats>; children: ReactNode }) {
  const [period, setPeriod] = useState<Period>("30d");
  const stats = periods[period];
  const health = share(stats.checkoutsPaid, stats.finished);
  const firstTry = share(stats.paidFirstTry, stats.finished);
  const outcomes = [
    { label: "Created", value: stats.checkouts },
    { label: "Paid", value: stats.checkoutsPaid },
    { label: "Returned", value: stats.refunds },
    { label: "Expired or failed", value: stats.expiredOrFailed },
  ];

  return (
    <Card className="flex min-w-0 flex-col gap-5 p-5 sm:p-6">
      <CardHeading
        icon="activity"
        title="Payment health"
        description="How many checkouts end in a paid payment."
        aside={<PeriodTabs value={period} onChange={setPeriod} label="Payment health period" />}
      />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {/** Fixed height: the rolling digits are taller than the plain dash shown without data. */}
          <p className="flex h-14 items-center gap-2">
            {stats.finished > 0 ? (
              <AnimatedNumber value={health} format="percent" className="font-heading text-4xl font-semibold tracking-tight" />
            ) : (
              <span className="font-heading text-4xl font-semibold tracking-tight">—</span>
            )}
            <HealthChip finished={stats.finished} percent={health} healthy={HEALTHY_PERCENT} watch={WATCH_PERCENT} />
          </p>
          <p className="mt-1 text-meta text-muted">
            {stats.finished} finished {stats.finished === 1 ? "checkout" : "checkouts"}
          </p>
        </div>
        <div className="w-full sm:w-60">
          <p className="flex items-center justify-between gap-3 text-meta">
            <span className="text-muted">Paid on the first try</span>
            <AnimatedNumber value={firstTry} format="percent" className="font-semibold" />
          </p>
          <div role="progressbar" aria-label="Paid on the first try" aria-valuemin={0} aria-valuemax={100} aria-valuenow={firstTry} className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]" style={{ width: `${firstTry}%` }} />
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-line bg-line sm:grid-cols-4">
        {outcomes.map((outcome) => (
          <div key={outcome.label} className="flex flex-col-reverse gap-0.5 bg-surface px-4 py-3">
            <dt className="text-meta text-muted">{outcome.label}</dt>
            <dd className="text-lg font-semibold tracking-tight">
              <AnimatedNumber value={outcome.value} />
            </dd>
          </div>
        ))}
      </dl>

      {children}
    </Card>
  );
}
