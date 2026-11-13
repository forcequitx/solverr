import type { Metadata } from "next";
import { AgentPayments } from "@/components/dashboard/agents/agent-payments";
import { AgentRevenueCard } from "@/components/dashboard/agents/agent-revenue-card";
import { CreditAccounts } from "@/components/dashboard/agents/credit-accounts";
import { TopResourcesCard } from "@/components/dashboard/agents/top-resources-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { KpiCard } from "@/components/dashboard/stats/kpi-card";
import { requireMerchant } from "@/lib/auth/session";
import { agentStats, RECENT_PAYMENTS } from "@/lib/merchants/agent-stats";

export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage() {
  const { merchant, mode } = await requireMerchant();
  const stats = await agentStats(merchant.id, mode);

  return (
    <>
      <PageHeader title="AI agents" description="What AI agents paid for your API: their payments, the routes they paid for, and their prepaid credits." />
      <div className="flex flex-col gap-4 sm:gap-5">
        <div className="grid auto-rows-fr grid-cols-2 gap-4 sm:gap-5 xl:grid-cols-4">
          <KpiCard icon="agents" tint="lime" label="Agent payments · 30 days" value={stats.payments} />
          <KpiCard icon="developers" tint="blue" label={stats.countedFrom ? `Paid routes · since ${stats.countedFrom}` : "Paid routes · 30 days"} value={stats.resourceCount} />
          <KpiCard icon="wallet" tint="lime" label="Credit accounts" value={stats.credits.accounts} />
          <KpiCard icon="coins" tint="blue" label="Prepaid credit balance" value={stats.credits.balanceUsd} format="usd" />
        </div>

        <div className="grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <AgentRevenueCard days={stats.days} revenueUsd={stats.revenueUsd} countedFrom={stats.countedFrom} />
          <TopResourcesCard resources={stats.resources} resourceCount={stats.resourceCount} countedFrom={stats.countedFrom} />
        </div>

        <AgentPayments payments={stats.recent} limit={RECENT_PAYMENTS} />
        <CreditAccounts accounts={stats.credits.rows} total={stats.credits.accounts} />
      </div>
    </>
  );
}
