import type { Invoice, OneClickStatus, PaymentEvent, Quote } from "@/generated/prisma/client";
import type { TimelineStep } from "@/components/dashboard/detail/status-timeline";
import { getChain } from "@/lib/chains/registry";
import { formatUtcDateTime } from "@/lib/format";
import { ARRIVED_STATUSES } from "@/lib/invoices/statuses";
import { formatBaseUnits } from "@/lib/money";

type QuoteWithEvents = Quote & { events: PaymentEvent[] };

const RECEIVED: ReadonlySet<OneClickStatus> = new Set(["KNOWN_DEPOSIT_TX", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS"]);
/** For open invoices, the index of the step that is in progress. */
const CURRENT_STEP: Partial<Record<Invoice["status"], number>> = { created: 1, awaiting_payment: 2, detected: 3, processing: 3 };

const time = (date: Date | null | undefined) => (date ? formatUtcDateTime(date) : undefined);

/** Checkout-to-settlement steps from the invoice and its quotes' 1Click events; open invoices show steps ahead, unpaid closed ones end at the outcome. */
export function paymentTimeline(invoice: Invoice, quotes: QuoteWithEvents[]): TimelineStep[] {
  const events = quotes.flatMap((quote) => quote.events).sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  const firstQuote = quotes.reduce<QuoteWithEvents | undefined>((first, quote) => (!first || quote.createdAt < first.createdAt ? quote : first), undefined);
  const shownQuote = quotes.find((quote) => quote.id === invoice.paidQuoteId) ?? quotes[0];
  /** A refunded or failed attempt can be followed by another one, so an earlier deposit does not count while the invoice waits again. */
  const deposit = invoice.status === "awaiting_payment" ? undefined : events.find((event) => RECEIVED.has(event.oneclickStatus));
  const arrived = deposit !== undefined || ARRIVED_STATUSES.has(invoice.status);
  const converting = events.find((event) => event.oneclickStatus === "PROCESSING");
  const lastEvent = (status: OneClickStatus) => events.findLast((event) => event.oneclickStatus === status);
  const settled = `${formatBaseUnits(BigInt(invoice.amountOutBase), invoice.destinationDecimals)} ${invoice.destinationSymbol}`;

  const progress: TimelineStep[] = [
    { id: "created", label: "Checkout created", time: time(invoice.createdAt), state: "done" },
    {
      id: "coin",
      label: "Customer chose a coin",
      detail: shownQuote ? `${shownQuote.amountInFormatted} ${shownQuote.originSymbol} on ${getChain(shownQuote.originChain)?.name ?? shownQuote.originChain}` : "The customer has not chosen a coin yet.",
      time: time(firstQuote?.createdAt),
      state: firstQuote ? "done" : "upcoming",
    },
    {
      id: "received",
      label: "Deposit received",
      detail: arrived ? "The customer's deposit arrived at the payment address." : `Waiting for the deposit. The checkout expires ${formatUtcDateTime(invoice.expiresAt)}.`,
      time: time(deposit?.receivedAt),
      state: arrived ? "done" : "upcoming",
    },
    {
      id: "converting",
      label: "Converting through NEAR Intents",
      detail: `The deposit is swapped to ${invoice.destinationSymbol} for your payout wallet.`,
      time: time(converting?.receivedAt),
      state: converting && invoice.status !== "processing" ? "done" : "upcoming",
    },
  ];

  if (invoice.status === "paid") {
    return [...progress.map((step) => ({ ...step, state: "done" as const })), { id: "paid", label: "Paid", detail: `${settled} sent to your payout wallet.`, time: time(invoice.paidAt), state: "done" }];
  }

  const current = CURRENT_STEP[invoice.status];
  if (current !== undefined) {
    return [
      ...progress.map((step, index): TimelineStep => ({ ...step, time: index <= current ? step.time : undefined, state: index < current ? "done" : index === current ? "current" : "upcoming" })),
      { id: "paid", label: "Paid", detail: `${settled} goes to your payout wallet.`, state: "upcoming" },
    ];
  }

  const reached = progress.filter((step) => step.state === "done");
  const outcomes: Partial<Record<Invoice["status"], TimelineStep>> = {
    underpaid: {
      id: "underpaid",
      label: "Underpaid",
      detail: "The deposit was less than the amount due, so NEAR Intents returns it to the customer.",
      time: time(lastEvent("INCOMPLETE_DEPOSIT")?.receivedAt),
      state: "warn",
    },
    refunded: {
      id: "refunded",
      label: "Refunded to the customer",
      detail: lastEvent("REFUNDED")?.refundReason ?? "NEAR Intents returned the deposit to the customer's refund address.",
      time: time(lastEvent("REFUNDED")?.receivedAt),
      state: "warn",
    },
    failed: { id: "failed", label: "Payment failed", detail: "The swap did not complete. A support case was opened for it.", time: time(lastEvent("FAILED")?.receivedAt), state: "failed" },
    expired: { id: "expired", label: "Checkout expired", detail: "The customer did not pay before the checkout expired.", time: time(invoice.expiresAt), state: "failed" },
  };
  const outcome = outcomes[invoice.status];
  return outcome ? [...reached, outcome] : reached;
}
