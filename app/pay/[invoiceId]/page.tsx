import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Checkout } from "@/components/checkout/checkout";
import { getDb } from "@/lib/db";
import { en } from "@/lib/i18n/messages/en";
import { displayTokens, isUsdStablecoin } from "@/lib/oneclick/tokens";
import { getCheckoutState } from "@/lib/payments/checkout-state";
import { checkoutCoins } from "@/lib/payments/coins";
import { routeFloor, routeLimitsInto, routeRefusal } from "@/lib/payments/route-limits";

export const metadata: Metadata = { title: en.meta.payTitle, robots: { index: false } };

export default async function PayPage({ params, searchParams }: PageProps<"/pay/[invoiceId]">) {
  const { invoiceId } = await params;
  const { embed } = await searchParams;
  const state = await getCheckoutState(invoiceId);
  if (!state) notFound();

  /** The checkout state names the settlement coin by symbol only, so its asset id is read here to find its price. */
  const invoice = await getDb().invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { destinationAsset: true } });
  /** The last coin list read, so a 1Click outage still shows the payment's status (with no coins to choose until it is back). */
  const tokens = await displayTokens();
  const settlementToken = tokens.find((token) => token.assetId === invoice.destinationAsset);
  /** Without a price, a dollar stablecoin counts as $1; any other coin gets no estimate rather than a wrong one. */
  const price = settlementToken?.price || (settlementToken && isUsdStablecoin(settlementToken) ? 1 : null);
  const amountUsd = price ? Number(state.settlement.amount) * price : null;
  /** The worker's route answers apply to live payments; the demo store's simulated network has no limits. */
  const limits = state.mode === "live" ? await routeLimitsInto(invoice.destinationAsset) : new Map();
  const coins = checkoutCoins({ assetId: invoice.destinationAsset, symbol: state.settlement.symbol }, tokens).map((coin) => ({
    ...coin,
    refusal: routeRefusal(limits.get(coin.assetId), amountUsd),
    floorUsd: routeFloor(limits.get(coin.assetId)),
  }));

  return <Checkout initial={state} coins={coins} amountUsd={amountUsd} embedded={embed === "1"} />;
}
