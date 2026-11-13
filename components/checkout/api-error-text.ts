import { CheckoutApiError } from "@/components/checkout/checkout-api";
import { formatWait } from "@/lib/format";
import { format } from "@/lib/i18n/interpolate";
import type { CheckoutMessages } from "@/lib/i18n/messages/en";
import { FIAT_AMOUNT_MAX, formatMinimumUsd } from "@/lib/money";
import type { CheckoutCoin } from "@/lib/payments/coins";

/** The dollar minimum in a quote rejection such as "needs a payment of at least $100 right now". */
const MINIMUM_AMOUNT = /\$([\d.,]+)/;

type Settlement = { symbol: string; chainName: string };

/** Text for a coin NEAR Intents refuses: its dollar minimum when named, suggesting the merchant's own coin unless that is the one refused. */
export function coinRefusalText(messages: CheckoutMessages, coin: CheckoutCoin, minimum: string | null, settlement?: Settlement): string {
  const m = messages.apiErrors;
  if (!minimum) return format(m.coinUnavailable, { symbol: coin.symbol, chain: coin.chainName });
  const values = { symbol: coin.symbol, chain: coin.chainName, minimum: formatMinimumUsd(Number(minimum.replace(/,/g, ""))) };
  return settlement && !coin.sameAsSettlement
    ? format(m.belowMinimum, { ...values, settlement: settlement.symbol, settlementChain: settlement.chainName })
    : format(m.belowMinimumChooseAnother, values);
}

/** Customer-facing text for a failed checkout request by status, type and field; `coin` and `settlement` fill in quote errors, else `fallback`. */
export function apiErrorText(
  cause: unknown,
  messages: CheckoutMessages,
  {
    coin,
    settlement,
    fallback = messages.common.genericError,
  }: { coin?: CheckoutCoin; settlement?: Settlement; fallback?: string } = {},
): string {
  if (!(cause instanceof CheckoutApiError)) return fallback;
  const m = messages.apiErrors;
  if (cause.status === 429) return format(cause.code === "too_many_attempts" ? m.tooManyAttempts : m.tooManyRequests, { wait: formatWait(cause.retryAfter ?? 60) });
  if (cause.status === 404) return messages.errors.notFoundTitle;
  if (cause.status === 502) return m.networkUnavailable;
  switch (cause.param) {
    case "refund_address":
      return coin ? format(m.invalidRefundAddress, { chain: coin.chainName }) : fallback;
    case "origin_asset":
      return coin ? coinRefusalText(messages, coin, MINIMUM_AMOUNT.exec(cause.message)?.[1] ?? null, settlement) : fallback;
    case "email":
      return messages.receiptEmail.invalidEmail;
    case "amount":
      return format(messages.paymentLink.amountInvalid, { max: FIAT_AMOUNT_MAX });
  }
  if (cause.type === "quote_unavailable") return m.privateUnavailable;
  if (cause.code === "invoice_paid") return m.invoicePaid;
  if (cause.code === "invoice_expired") return m.invoiceExpired;
  if (cause.code === "payment_in_progress") return m.paymentInProgress;
  if (cause.code === "payout_changed") return m.payoutChanged;
  if (cause.type === "invalid_state" && coin) return m.paymentClosed;
  return fallback;
}
