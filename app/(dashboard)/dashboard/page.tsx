import type { Metadata } from "next";
import Link from "next/link";
import { ChainsCard } from "@/components/dashboard/overview/chains-card";
import { CheckoutsCard } from "@/components/dashboard/overview/checkouts-card";
import { DailyRhythm } from "@/components/dashboard/overview/daily-rhythm";
import { PaymentHealthCard } from "@/components/dashboard/overview/payment-health-card";
import { RevenueCard } from "@/components/dashboard/overview/revenue-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { paymentListRow } from "@/components/dashboard/payments/list-row";
import { PaymentList } from "@/components/dashboard/payments/payment-list";
import { ChangeChip, Chip, CountChangeChip } from "@/components/dashboard/stats/chip";
import { KpiCard } from "@/components/dashboard/stats/kpi-card";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { requireMerchant } from "@/lib/auth/session";
import { PAYOUT_WALLET_REQUIRED } from "@/lib/merchants/actions/shared";
import { paymentRows } from "@/lib/merchants/payment-stats";
import { overviewData } from "@/lib/merchants/stats";

const LATEST_PAYMENTS = 50;

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const { merchant, mode, role } = await requireMerchant();
  const [overview, rows] = await Promise.all([overviewData(merchant.id, mode), paymentRows(merchant.id, mode, { take: LATEST_PAYMENTS })]);
  const { kpis } = overview;

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          merchant.payoutVerifiedAt ? (
            "Payments, revenue, checkouts and the networks your customers pay from."
          ) : role !== "owner" ? (
            PAYOUT_WALLET_REQUIRED
          ) : (
            <Link href="/dashboard/settings" className="font-medium text-accent-text hover:underline">
              Verify your payout wallet to start accepting payments.
            </Link>
          )
        }
        action={
          <ButtonLink href="/dashboard/links" size="sm">
            <Icon name="plus" className="size-4" />
            New payment link
          </ButtonLink>
        }
      />

      <div className="flex flex-col gap-4 sm:gap-5">
        <div className="grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <PaymentHealthCard periods={overview.periods}>
            <DailyRhythm heatmap={overview.heatmap} />
          </PaymentHealthCard>
          <RevenueCard periods={overview.periods} />
        </div>

        <div className="grid auto-rows-fr grid-cols-2 gap-4 sm:gap-5 xl:grid-cols-4">
          <KpiCard icon="trendUp" tint="lime" label="Revenue · 7 days" value={kpis.revenueUsd} format="usd" chip={<ChangeChip current={kpis.revenueUsd} previous={kpis.previousRevenueUsd} />} />
          <KpiCard icon="payments" tint="blue" label="Paid payments · 7 days" value={kpis.payments} chip={<ChangeChip current={kpis.payments} previous={kpis.previousPayments} />} />
          <KpiCard icon="agents" tint="lime" label="Agent payments · 7 days" value={kpis.agentPayments} chip={<CountChangeChip current={kpis.agentPayments} previous={kpis.previousAgentPayments} />} />
          <KpiCard
            icon="lifebuoy"
            tint="blue"
            label="Open support cases"
            value={kpis.openCases}
            chip={kpis.openCases > 0 ? <Chip tone="danger">to resolve</Chip> : <Chip tone="muted">clear</Chip>}
            href="/dashboard/support"
          />
        </div>

        <div className="grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <ChainsCard chains={overview.chains} />
          <CheckoutsCard periods={overview.periods} />
        </div>

        <PaymentList rows={rows.map(paymentListRow)} title="Latest payments" pageSize={8} limit={LATEST_PAYMENTS} />
      </div>
    </>
  );
}
