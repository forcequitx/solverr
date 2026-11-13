import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { Chip } from "@/components/dashboard/stats/chip";
import { KpiCard } from "@/components/dashboard/stats/kpi-card";
import { SubscriptionList } from "@/components/dashboard/subscriptions/subscription-list";
import { requireMerchant } from "@/lib/auth/session";
import { emailEnabled } from "@/lib/email/send";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";
import { subscriptionLists, SUBSCRIPTIONS_SHOWN, subscriptionTotals } from "@/lib/merchants/subscription-stats";

export const metadata: Metadata = { title: "Subscriptions" };

export default async function SubscriptionsPage() {
  const { merchant, role } = await requireMerchant();
  const [{ rows, upcoming }, totals] = await Promise.all([subscriptionLists(merchant.id), subscriptionTotals(merchant.id)]);

  return (
    <>
      <PageHeader title="Subscriptions" description="Recurring payments: one invoice per week or month." />
      <div className="flex flex-col gap-4 sm:gap-5">
        <div className="grid auto-rows-fr grid-cols-2 gap-4 sm:gap-5 xl:grid-cols-4">
          <KpiCard icon="subscriptions" tint="lime" label="Active subscriptions" value={totals.active} />
          <KpiCard icon="close" tint="blue" label="Canceled" value={totals.canceled} />
          <KpiCard icon="trendUp" tint="lime" label="Billed each month" value={totals.monthlyUsd} format="usd" />
          <KpiCard icon="check" tint="blue" label="Subscription invoices paid" value={totals.paidInvoices} chip={<Chip tone="muted">of {totals.invoices}</Chip>} />
        </div>
        <p className="-mt-1 px-1 text-meta text-muted sm:-mt-2">Billed each month adds up active subscriptions in USD at current ECB rates; a weekly plan counts as 52 ÷ 12 invoices a month.</p>
        <SubscriptionList editable={role !== "viewer"} rows={rows} limit={SUBSCRIPTIONS_SHOWN} upcoming={upcoming} customerEmails={emailEnabled() ? "on" : "off"} currencies={SUPPORTED_CURRENCIES} />
      </div>
    </>
  );
}
