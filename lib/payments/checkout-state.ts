import type { OneClickStatus } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { emailEnabled } from "@/lib/email/send";
import { logoUrl } from "@/lib/merchants/logo";
import { formatBaseUnits } from "@/lib/money";
import { paymentsDelayed } from "@/lib/payments/health";
import { MIN_QUOTE_MS, QUOTABLE, reportedInFlight } from "@/lib/payments/quote";
import { receiptStillSent } from "@/lib/payments/receipts";
import { serializePayment } from "@/lib/payments/serialize";

/** Payment statuses of a deposit that has arrived and is still being handled. */
const IN_FLIGHT: ReadonlySet<OneClickStatus> = new Set(["KNOWN_DEPOSIT_TX", "INCOMPLETE_DEPOSIT", "PROCESSING"]);
/** Newest deposit addresses considered when choosing the payment to show; an invoice gets at most 10 an hour. */
const SHOWN_QUOTE_CANDIDATES = 50;

/** Records that a checkout of the invoice is open, which makes the worker poll its active quote faster. */
export async function markCheckoutSeen(invoiceId: string): Promise<void> {
  await getDb().quote.updateMany({ where: { invoiceId, state: "active" }, data: { checkoutSeenAt: new Date() } });
}

/** What the public checkout page needs about an invoice, with nothing private to the merchant; `markSeen` calls `markCheckoutSeen`. */
export async function getCheckoutState(invoiceId: string, { markSeen = true }: { markSeen?: boolean } = {}) {
  const db = getDb();
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      merchant: { select: { name: true, logoId: true } },
      quotes: { orderBy: { createdAt: "desc" }, take: SHOWN_QUOTE_CANDIDATES, include: { events: { orderBy: { receivedAt: "desc" }, take: 1 } } },
    },
  });
  if (!invoice) return undefined;

  if (markSeen && invoice.quotes[0]?.state === "active") await markCheckoutSeen(invoiceId);
  /** Shows the paying quote, else one in flight (switching coins after sending retires the address, not the payment), else the newest. */
  const quote =
    invoice.quotes.find((candidate) => candidate.id === invoice.paidQuoteId) ??
    invoice.quotes.find((candidate) => IN_FLIGHT.has(candidate.oneclickStatus)) ??
    invoice.quotes[0];
  const paid = invoice.status === "paid";
  const payment = quote ? serializePayment(quote, quote.events[0], invoice.destinationChain) : null;
  /** This page is public, so a private payment leaves out the delivery to the merchant's wallet, which would link the two. */
  const shown = payment?.confidential ? { ...payment, destination_transactions: [] as typeof payment.destination_transactions } : payment;

  return {
    id: invoice.id,
    object: "checkout",
    mode: invoice.mode,
    status: invoice.status,
    merchant: { name: invoice.merchant.name, logo_url: logoUrl(invoice.merchant.logoId) },
    amount: invoice.amount.toFixed(2),
    currency: invoice.currency,
    /** The invoice's `description` is the business's own note and stays out of this public view; the receipt shows the order reference. */
    order_id: invoice.orderId,
    settlement: {
      symbol: invoice.destinationSymbol,
      blockchain: invoice.destinationChain,
      amount: formatBaseUnits(BigInt(invoice.amountOutBase), invoice.destinationDecimals),
    },
    late: invoice.late,
    extra_payment: invoice.extraPayment,
    expires_at: invoice.expiresAt.toISOString(),
    paid_at: invoice.paidAt?.toISOString() ?? null,
    /** A new attempt needs an invoice that takes payments and at least two minutes of its lifetime left. */
    retry_allowed: QUOTABLE.has(invoice.status) && invoice.expiresAt.getTime() - Date.now() > MIN_QUOTE_MS,
    redirect_url: paid ? invoice.redirectUrl : null,
    /** `reported`: a transaction to this address was reported and NEAR Intents has not seen it yet, so a reloaded page must not
        offer the address for a second payment. */
    payment: quote && shown ? { ...shown, state: quote.state, reported: reportedInFlight(quote) } : null,
    /** Test mode uses the simulated payment network, which a slow NEAR Intents cannot delay. */
    payments_delayed: invoice.mode === "live" && (await paymentsDelayed()),
    /** The checkout offers a receipt email only when sending email is configured, never in test mode, which emails no customer, and not
        once the payment was paid longer ago than the receipt job looks back. */
    email_receipts: emailEnabled() && invoice.mode === "live" && receiptStillSent(invoice),
    receipt_email_set: invoice.customerEmail !== null,
  };
}

export type CheckoutState = NonNullable<Awaited<ReturnType<typeof getCheckoutState>>>;
