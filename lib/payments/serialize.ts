import type { PaymentEvent, Quote } from "@/generated/prisma/client";
import { type ChainInfo, explorerTxUrl, getChain } from "@/lib/chains/registry";
import { formatBaseUnits } from "@/lib/money";
import { isConfidentialQuote } from "@/lib/oneclick/confidentiality";
import type { TransactionDetails } from "@/lib/oneclick/types";

/** 1Click's explorer link, kept only if https on this chain's own explorer host; public pages show it, so others are replaced. */
function trustedExplorerUrl(url: string | undefined, chain: ChainInfo): string | null {
  if (!url || !URL.canParse(url)) return null;
  const parsed = new URL(url);
  return parsed.protocol === "https:" && parsed.host === new URL(chain.explorerTx).host ? parsed.toString() : null;
}

function transactions(value: unknown, chainId: string) {
  const chain = getChain(chainId);
  return ((value as TransactionDetails[] | null) ?? []).map((tx) => ({
    hash: tx.hash,
    url: chain && !tx.hash.startsWith("test_") ? (trustedExplorerUrl(tx.explorerUrl, chain) ?? explorerTxUrl(chain, tx.hash)) : null,
  }));
}

const amount = (base: string | null | undefined, decimals: number) => (base ? formatBaseUnits(BigInt(base), decimals) : null);

/** Public shape of one payment attempt (a quote and its latest 1Click status). */
export function serializePayment(quote: Quote, latest: PaymentEvent | null | undefined, destinationChain: string) {
  return {
    id: quote.id,
    object: "payment",
    status: quote.oneclickStatus.toLowerCase(),
    coin: {
      asset_id: quote.originAsset,
      symbol: quote.originSymbol,
      blockchain: quote.originChain,
      chain_name: getChain(quote.originChain)?.name ?? quote.originChain,
      decimals: quote.originDecimals,
    },
    /** Derived from `amount_in_base`, so the amount shown and copied always matches the one the QR code and wallets send. */
    amount_in: formatBaseUnits(BigInt(quote.amountIn), quote.originDecimals),
    amount_in_base: quote.amountIn,
    min_amount_in_base: quote.minAmountIn,
    amount_in_usd: quote.amountInUsd,
    deposit_address: quote.depositAddress,
    deposit_memo: quote.depositMemo,
    refund_address: quote.refundTo,
    confidential: isConfidentialQuote(quote.rawResponse),
    deadline: quote.deadline.toISOString(),
    time_estimate_seconds: quote.timeEstimate,
    deposited_amount: amount(latest?.depositedAmount, quote.originDecimals),
    refunded_amount: amount(latest?.refundedAmount, quote.originDecimals),
    refund_fee: amount(latest?.refundFee, quote.originDecimals),
    refund_reason: latest?.refundReason ?? null,
    origin_transactions: transactions(latest?.originTxs, quote.originChain),
    destination_transactions: transactions(latest?.destinationTxs, destinationChain),
    correlation_id: quote.correlationId,
    quote_signature: quote.signature,
    created_at: quote.createdAt.toISOString(),
  };
}
