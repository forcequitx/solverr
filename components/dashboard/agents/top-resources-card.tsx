import { AnimatedNumber } from "@/components/ui/animated-number";
import { Card } from "@/components/ui/card";
import { IconBox } from "@/components/ui/icon-box";
import { formatUsd } from "@/lib/format";
import type { AgentResource } from "@/lib/merchants/agent-stats";

/** Same height as the revenue chart beside it (`CHART_HEIGHT`, 208px), which fits the four top routes; the empty state keeps it too. */
const LIST_HEIGHT = "min-h-[208px]";

/** The routes agents paid for most in the last 30 days (from `countedFrom` on when there were more calls than the stats read),
    with each one's share of agent revenue. */
export function TopResourcesCard({ resources, resourceCount, countedFrom }: { resources: AgentResource[]; resourceCount: number; countedFrom: string | null }) {
  return (
    <Card className="flex min-w-0 flex-col gap-5 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <IconBox name="developers" tint="blue" />
        <div className="min-w-0">
          <h2 className="text-meta text-muted">Top paid routes</h2>
          <p className="mt-1 font-heading text-3xl font-semibold tracking-tight">
            <AnimatedNumber value={resourceCount} suffix={resourceCount === 1 ? " route" : " routes"} />
          </p>
          <p className="text-meta text-muted">{countedFrom ? `Since ${countedFrom}` : "Last 30 days"}</p>
        </div>
      </div>
      {resources.length === 0 ? (
        <p className={`grid flex-1 place-items-center rounded-[16px] border border-dashed border-line px-6 text-center text-meta text-muted ${LIST_HEIGHT}`}>
          Each route behind the paywall shows here after its first paid call.
        </p>
      ) : (
        <ol className={`flex flex-1 flex-col gap-3 ${LIST_HEIGHT}`}>
          {resources.map((entry, index) => (
            <li key={entry.resource} className="flex animate-row-in flex-col gap-1.5" style={{ animationDelay: `${index * 40}ms` }}>
              <p className="flex items-center justify-between gap-3 text-meta">
                <span className="truncate font-mono" title={entry.resource}>
                  {entry.resource}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{formatUsd(entry.revenueUsd)}</span>
              </p>
              <div className="flex items-center gap-3">
                <div role="progressbar" aria-label={`${entry.resource}: ${entry.share}% of agent revenue`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={entry.share} className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div className={`h-full rounded-full ${index % 2 === 0 ? "bg-[var(--chart-1)]" : "bg-[var(--chart-2)]"}`} style={{ width: `${entry.share}%` }} />
                </div>
                <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted">
                  {entry.payments} {entry.payments === 1 ? "call" : "calls"}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
