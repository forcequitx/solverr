import type { Metadata } from "next";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { SectionCard } from "@/components/dashboard/section-card";
import { Chip } from "@/components/dashboard/stats/chip";
import { KpiCard } from "@/components/dashboard/stats/kpi-card";
import { CasesByProblem } from "@/components/dashboard/support/cases-by-problem";
import { SupportCases, type SupportCaseRow } from "@/components/dashboard/support/support-cases";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { Icon } from "@/components/ui/icon";
import { requireMerchant } from "@/lib/auth/session";
import { RECENT_CASE_DAYS, supportCases, supportSummary } from "@/lib/merchants/support-stats";
import { NEAR_INTENTS_SUPPORT_URL } from "@/lib/support/cases";

const CASE_LIMIT = 100;

const STEPS = [
  "Open a case and copy its report.",
  "Send the report to NEAR Intents support, who can trace the funds.",
  "When the customer's payment is sorted out, mark the case resolved.",
];

export const metadata: Metadata = { title: "Support" };

export default async function SupportPage() {
  const { merchant, mode, role } = await requireMerchant();
  const [cases, summary] = await Promise.all([
    supportCases(merchant.id, mode, CASE_LIMIT),
    supportSummary(merchant.id, mode),
  ]);
  const failedSwaps = summary.byKind.swap_failed?.total ?? 0;

  const rows = cases.map((supportCase): SupportCaseRow => {
    const report = (supportCase.report ?? {}) as Record<string, unknown>;
    /** Cases opened by a failed swap keep the transaction and chain on the case itself rather than in the report. */
    const fields = { tx_hash: supportCase.txHash, chain: supportCase.chain, ...report };
    const details = Object.entries(fields)
      .filter(([, value]) => value)
      .map(([key, value]): [string, string] => [key === "invoice_id" ? "payment id" : key.replace(/_/g, " "), String(value)]);
    return {
      id: supportCase.id,
      kind: supportCase.kind,
      status: supportCase.status,
      invoiceId: supportCase.invoiceId,
      createdAt: supportCase.createdAt.toISOString(),
      details,
      reportText: [`Solverr support case ${supportCase.id}`, ...details.map(([label, value]) => `${label}: ${value}`)].join("\n"),
    };
  });

  return (
    <>
      <PageHeader
        title="Support"
        description={
          <>
            Each case holds what NEAR Intents support needs to trace the funds. Nobody at Solverr can move funds; send the report to{" "}
            <a href={NEAR_INTENTS_SUPPORT_URL} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">
              NEAR Intents support
            </a>
            .
          </>
        }
      />

      <div className="flex flex-col gap-4 sm:gap-5">
        <div className="grid auto-rows-fr grid-cols-2 gap-4 sm:gap-5 xl:grid-cols-4">
          <KpiCard icon="lifebuoy" tint="blue" label="Open cases" value={summary.open} chip={summary.open > 0 ? <Chip tone="danger">to resolve</Chip> : <Chip tone="muted">clear</Chip>} />
          <KpiCard icon="check" tint="lime" label="Resolved cases" value={summary.resolved} />
          <KpiCard icon="activity" tint="blue" label={`Opened · ${RECENT_CASE_DAYS} days`} value={summary.recent} />
          <KpiCard icon="alert" tint="lime" label="Failed swaps" value={failedSwaps} chip={failedSwaps > 0 ? <Chip tone="warn">auto-opened</Chip> : null} />
        </div>

        <div className="grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <SupportCases
            editable={role !== "viewer"}
            cases={rows}
            limit={CASE_LIMIT}
            empty={<EmptyState title="No support cases">Customers report payment problems from the help link in the checkout, and failed swaps open a case on their own.</EmptyState>}
          />
          <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
            <CasesByProblem byKind={summary.byKind} />
            <SectionCard className="flex-1" icon="support" tint="blue" title="How to resolve a case" description="Solverr never holds funds, so NEAR Intents support traces them.">
              <ol className="flex flex-col gap-3">
                {STEPS.map((step, index) => (
                  <li key={step} className="flex items-start gap-3 text-sm">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold tabular-nums">{index + 1}</span>
                    <span className="pt-0.5">{step}</span>
                  </li>
                ))}
              </ol>
              <a
                href={NEAR_INTENTS_SUPPORT_URL}
                target="_blank"
                rel="noreferrer"
                className={`mt-auto inline-flex items-center gap-1.5 self-start text-sm font-semibold text-accent-text pointer-coarse:min-h-11 hover:underline ${FOCUS_RING}`}
              >
                Open NEAR Intents support
                <Icon name="arrowUpRight" className="size-4" />
              </a>
            </SectionCard>
          </div>
        </div>
      </div>
    </>
  );
}
