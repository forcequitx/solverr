import type { Metadata } from "next";
import { PaymentLinks } from "@/components/dashboard/links/payment-links";
import { PageHeader } from "@/components/dashboard/page-header";
import { Chip } from "@/components/dashboard/stats/chip";
import { KpiCard } from "@/components/dashboard/stats/kpi-card";
import { requireMerchant } from "@/lib/auth/session";
import { share } from "@/lib/format";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";
import { linkRows, linkTotals, linkUsage } from "@/lib/merchants/link-stats";
import { serializePaymentLink } from "@/lib/payment-links/links";

const LINKS_SHOWN = 100;

export const metadata: Metadata = { title: "Payment links" };

export default async function LinksPage() {
  const { merchant, mode, role } = await requireMerchant();
  const [links, totals] = await Promise.all([
    linkRows(merchant.id, mode, LINKS_SHOWN),
    linkTotals(merchant.id, mode),
  ]);
  const usage = await linkUsage(
    merchant.id,
    mode,
    links.map((link) => link.id),
  );
  const paidShare = share(totals.paid, totals.checkouts);

  return (
    <>
      <PageHeader title="Payment links" description="Share a link and get paid in any coin. No website or code needed." />
      <div className="flex flex-col gap-4 sm:gap-5">
        <div className="grid auto-rows-fr grid-cols-2 gap-4 sm:gap-5 xl:grid-cols-4">
          <KpiCard icon="links" tint="lime" label="Active links" value={totals.activeLinks} chip={<Chip tone="muted">of {totals.links}</Chip>} />
          <KpiCard icon="payments" tint="blue" label="Checkouts from links" value={totals.checkouts} />
          <KpiCard icon="check" tint="lime" label="Paid from links" value={totals.paid} />
          <KpiCard
            icon="trendUp"
            tint="blue"
            label="Checkouts paid"
            value={paidShare}
            format="percent"
            chip={totals.checkouts > 0 ? null : <Chip tone="muted">no data</Chip>}
          />
        </div>
        <PaymentLinks
          editable={role !== "viewer"}
          limit={LINKS_SHOWN}
          currencies={SUPPORTED_CURRENCIES}
          links={links.map((link) => {
            const serialized = serializePaymentLink(link);
            return {
              id: link.id,
              title: link.title,
              amount: serialized.amount,
              currency: link.currency,
              active: link.active,
              url: serialized.url,
              ...(usage.get(link.id) ?? { checkouts: 0, paid: 0, collected: "0.00" }),
            };
          })}
        />
      </div>
    </>
  );
}
