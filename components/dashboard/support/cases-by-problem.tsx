import type { SupportCaseKind } from "@/generated/prisma/client";
import { SectionCard } from "@/components/dashboard/section-card";
import { AnimatedNumber } from "@/components/ui/animated-number";
import type { SupportSummary } from "@/lib/merchants/support-stats";
import { CASE_KIND_LABELS } from "@/lib/support/case-kinds";

/** Every problem kind with its case count and a bar against the most common one; kinds without cases stay listed so the card keeps its size. */
export function CasesByProblem({ byKind }: { byKind: SupportSummary["byKind"] }) {
  const kinds = (Object.keys(CASE_KIND_LABELS) as SupportCaseKind[]).map((kind) => ({ kind, label: CASE_KIND_LABELS[kind], total: byKind[kind]?.total ?? 0, open: byKind[kind]?.open ?? 0 }));
  const most = Math.max(1, ...kinds.map((kind) => kind.total));

  return (
    <SectionCard icon="activity" title="Cases by problem" description="All cases on your payments.">
      <ul className="flex flex-col gap-3.5">
        {kinds.map((kind) => (
          <li key={kind.kind} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-meta">
              <span className={kind.total > 0 ? "font-medium" : "text-muted"}>{kind.label}</span>
              <span className="flex items-baseline gap-2 tabular-nums">
                {kind.open > 0 ? <span className="text-xs font-semibold text-warn">{kind.open} open</span> : null}
                <AnimatedNumber value={kind.total} className="font-semibold" />
              </span>
            </div>
            <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-[var(--chart-2)]" style={{ width: `${(kind.total / most) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
