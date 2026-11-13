"use client";

import { AreaChart } from "@/components/dashboard/charts/area-chart";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Card } from "@/components/ui/card";
import { IconBox } from "@/components/ui/icon-box";
import { formatUsd, formatUsdCompact } from "@/lib/format";
import type { AgentDay } from "@/lib/merchants/agent-stats";

/** Paid agent revenue per day over the last 30 days, or from `countedFrom` on when there were more calls than the stats read. */
export function AgentRevenueCard({ days, revenueUsd, countedFrom }: { days: AgentDay[]; revenueUsd: number; countedFrom: string | null }) {
  const payments = days.reduce((total, day) => total + day.payments, 0);
  return (
    <Card className="flex min-w-0 flex-col gap-5 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <IconBox name="trendUp" />
        <div className="min-w-0">
          <h2 className="text-meta text-muted">{countedFrom ? `Agent revenue · since ${countedFrom}` : "Agent revenue · 30 days"}</h2>
          <p className="mt-1">
            <AnimatedNumber value={revenueUsd} format="usd" className="font-heading text-3xl font-semibold tracking-tight" />
          </p>
          <p className="text-meta text-muted">
            <AnimatedNumber value={payments} suffix={payments === 1 ? " paid call" : " paid calls"} />
          </p>
        </div>
      </div>
      <AreaChart
        points={days.map((day) => ({ label: day.label, title: `${day.title} · ${day.payments} ${day.payments === 1 ? "call" : "calls"}`, value: day.revenueUsd }))}
        label={`Paid agent revenue per day ${countedFrom ? `since ${countedFrom}` : "over the last 30 days"}: ${formatUsd(revenueUsd)} from ${payments} paid calls.`}
        seriesName="Agent revenue"
        formatTick={formatUsdCompact}
        formatValue={formatUsd}
        emptyText="Revenue appears here after an agent pays for a call."
      />
    </Card>
  );
}
