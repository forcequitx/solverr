import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { Chip } from "@/components/dashboard/stats/chip";
import { KpiCard } from "@/components/dashboard/stats/kpi-card";
import { PayoutBatchForm } from "@/components/dashboard/transfers/payout-batch-form";
import { SentCard } from "@/components/dashboard/transfers/sent-card";
import { TransfersTable } from "@/components/dashboard/transfers/transfers-table";
import { requireMerchant } from "@/lib/auth/session";
import { TRANSFER_ROWS, transferStats } from "@/lib/merchants/transfer-stats";

export const metadata: Metadata = { title: "Refunds & payouts" };

export default async function TransfersPage() {
  const { merchant, role } = await requireMerchant();
  const stats = await transferStats(merchant.id);
  const editable = role !== "viewer";

  return (
    <>
      <PageHeader title="Refunds & payouts" description="Money only ever leaves from your own wallet: Solverr prepares each transfer and you approve it in your wallet." />
      <div className="flex flex-col gap-4 sm:gap-5">
        <div className="grid auto-rows-fr grid-cols-2 gap-4 sm:gap-5 xl:grid-cols-4">
          <KpiCard
            icon="wallet"
            tint="blue"
            label="Waiting for approval"
            value={stats.pending}
            chip={stats.pending > 0 ? <Chip tone="warn">approve</Chip> : <Chip tone="muted">clear</Chip>}
          />
          <KpiCard icon="check" tint="lime" label="Completed" value={stats.completed} />
          <KpiCard icon="alert" tint="blue" label="Failed" value={stats.failed} chip={stats.failed > 0 ? <Chip tone="danger">needs review</Chip> : null} />
          <KpiCard icon="trendUp" tint="lime" label="Sent in total" value={stats.paidOutUsd} format="usd" />
        </div>

        {editable ? (
          <div className="grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <SentCard periods={stats.periods} />
            <PayoutBatchForm exampleAsset={merchant.settlementAsset} />
          </div>
        ) : (
          <SentCard periods={stats.periods} />
        )}

        <TransfersTable rows={stats.rows} limit={TRANSFER_ROWS} editable={editable} />
      </div>
    </>
  );
}
