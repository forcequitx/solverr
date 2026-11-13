import type { Invoice, InvoiceStatus, Merchant, OneClickStatus, PaymentEvent, Prisma, Quote } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/ids";
import { serializeInvoice } from "@/lib/invoices/serialize";
import { createAlert } from "@/lib/merchants/alerts";
import { simulatedStepDelay } from "@/lib/oneclick/mock";
import type { QuoteResponse, StatusResponse } from "@/lib/oneclick/types";
import { notifyCheckout } from "@/lib/payments/checkout-events";
import { reportedInFlight, retireOpenQuotes } from "@/lib/payments/quote";
import { serializePayment } from "@/lib/payments/serialize";
import { lockInvoice } from "@/lib/row-locks";
import { createSplitPayouts } from "@/lib/splits/splits";
import { enqueueWebhook, type WebhookEventType } from "@/lib/webhooks/events";

const FINAL: ReadonlySet<OneClickStatus> = new Set(["SUCCESS", "REFUNDED", "FAILED"]);
/** How far a payment has moved; a status of lower rank than the stored one is out of date. */
const STATUS_RANK: Record<OneClickStatus, number> = {
  PENDING_DEPOSIT: 0,
  KNOWN_DEPOSIT_TX: 1,
  INCOMPLETE_DEPOSIT: 1,
  PROCESSING: 2,
  SUCCESS: 3,
  REFUNDED: 3,
  FAILED: 3,
};
const MOVING: ReadonlySet<OneClickStatus> = new Set(["KNOWN_DEPOSIT_TX", "PROCESSING", "INCOMPLETE_DEPOSIT"]);
const BEFORE_DETECTION: ReadonlySet<InvoiceStatus> = new Set(["created", "awaiting_payment", "expired", "refunded", "failed", "underpaid"]);
/** Invoice status implied by its latest quote; a latest quote that is still moving or paid implies no change. */
const STATUS_OF_LATEST: Partial<Record<OneClickStatus, InvoiceStatus>> = {
  PENDING_DEPOSIT: "awaiting_payment",
  INCOMPLETE_DEPOSIT: "underpaid",
  REFUNDED: "refunded",
  FAILED: "failed",
};
/** Event for a status a detected invoice falls back to; awaiting payment has none, so the business's next event follows later. */
const RESTORED_EVENT: Partial<Record<InvoiceStatus, WebhookEventType>> = {
  expired: "invoice.expired",
  underpaid: "invoice.underpaid",
  refunded: "invoice.refunded",
  failed: "invoice.failed",
};

export const POLL_MS = { checkoutOpen: 5_000, active: 15_000, activeIdle: 60_000, moving: 10_000, retired: 600_000, retiredIdle: 3_600_000, error: 30_000 } as const;
const CHECKOUT_OPEN_WINDOW_MS = 30_000;
const ACTIVE_IDLE_AFTER_MS = 10 * 60_000;
const RETIRED_IDLE_AFTER_MS = 2 * 60 * 60_000;

/** Delay before the worker polls this quote again. */
export function nextPollDelay(
  quote: Pick<Quote, "state" | "checkoutSeenAt" | "depositTxHash" | "walletSentAt" | "createdAt" | "simulatedAt" | "deadline">,
  status: OneClickStatus,
): number {
  /** A test payment walked by the Simulate panel changes on a fixed beat; checking on that beat shows each step as it happens. */
  if (quote.simulatedAt) return simulatedStepDelay(quote.simulatedAt);
  if (MOVING.has(status)) return POLL_MS.moving;
  /** A reported payment 1Click has not seen yet is watched closely only for a while (`reportedInFlight`), so made-up reports cannot crowd out real ones. */
  const reported = reportedInFlight({ depositTxHash: quote.depositTxHash, walletSentAt: quote.walletSentAt, oneclickStatus: status, deadline: quote.deadline });
  /** A replaced address the customer reported paying to is watched as closely as an open one. */
  if (quote.state === "retired" && !reported) {
    return Date.now() - quote.createdAt.getTime() > RETIRED_IDLE_AFTER_MS ? POLL_MS.retiredIdle : POLL_MS.retired;
  }
  const sinceSeen = Date.now() - (quote.checkoutSeenAt ?? quote.createdAt).getTime();
  if (quote.checkoutSeenAt && sinceSeen < CHECKOUT_OPEN_WINDOW_MS) return POLL_MS.checkoutOpen;
  /** An address nobody has looked at for a while and with no reported payment is checked less often; a deposit still shows within a minute. */
  if (!reported && sinceSeen > ACTIVE_IDLE_AFTER_MS) return POLL_MS.activeIdle;
  return POLL_MS.active;
}

/** `restored` marks a fall back to the latest quote's state, whose event describes that quote's payment rather than this one. */
type Transition = { data: Prisma.InvoiceUpdateInput; event?: WebhookEventType; alert?: string; supportCase?: boolean; restored?: boolean };

/** How an invoice changes when a quote reaches `status`; `latest` is the newest quote if not this one (else null),
    `depositSeenAt` when this deposit was first seen, `othersMoving` whether another quote's deposit is still moving. */
export function transition(
  invoice: Invoice,
  quote: Quote,
  status: OneClickStatus,
  latest: Pick<Quote, "oneclickStatus"> | null,
  depositSeenAt: Date,
  othersMoving: boolean,
): Transition | undefined {
  const isLatestQuote = latest === null;
  /** An older quote ending unpaid returns a detected invoice to the latest quote's state, or to expired if time ran out, with that state's event. */
  const fromLatest = latest && (invoice.status === "detected" || invoice.status === "processing") ? STATUS_OF_LATEST[latest.oneclickStatus] : undefined;
  const restored = fromLatest === "awaiting_payment" && invoice.expiresAt.getTime() <= Date.now() ? "expired" : fromLatest;
  const fallBack: Transition | undefined = restored ? { data: { status: restored }, event: RESTORED_EVENT[restored], restored: true } : undefined;

  if (invoice.status === "paid") {
    if (status === "SUCCESS" && invoice.paidQuoteId !== quote.id) {
      return {
        data: { extraPayment: true },
        event: "invoice.extra_payment",
        alert: `Payment ${invoice.id} was paid a second time. To return the extra amount, open it in Payments and select Refund this extra payment.`,
      };
    }
    /** A second payment that fails in the swap still leaves the customer's coins to sort out, so it gets a support case. */
    if (status === "FAILED" && invoice.paidQuoteId !== quote.id) {
      return { data: {}, alert: `An extra payment toward ${invoice.id} failed in the swap. A support case was opened; follow it in Support.`, supportCase: true };
    }
    return undefined;
  }

  /** Another payment of the invoice is still on its way, so this one ending does not decide the invoice's status; a failure still opens a case. */
  if (othersMoving && (status === "INCOMPLETE_DEPOSIT" || status === "REFUNDED" || status === "FAILED")) {
    return status === "FAILED" ? { data: {}, alert: `A payment toward ${invoice.id} failed in the swap. A support case was opened; follow it in Support.`, supportCase: true } : undefined;
  }

  switch (status) {
    case "SUCCESS": {
      /** Judged by when the deposit arrived, so a swap that finishes after expiry is not late when its deposit was on time. */
      const late = quote.state === "retired" || depositSeenAt > invoice.expiresAt;
      return { data: { status: "paid", paidQuoteId: quote.id, paidAt: new Date(), late }, event: "invoice.paid" };
    }
    case "KNOWN_DEPOSIT_TX":
      return BEFORE_DETECTION.has(invoice.status) ? { data: { status: "detected" }, event: "invoice.detected" } : undefined;
    case "PROCESSING":
      if (invoice.status === "processing") return undefined;
      return { data: { status: "processing" }, event: BEFORE_DETECTION.has(invoice.status) ? "invoice.detected" : undefined };
    case "INCOMPLETE_DEPOSIT":
      if (isLatestQuote) return { data: { status: "underpaid" }, event: "invoice.underpaid" };
      return fallBack;
    case "REFUNDED":
      if (isLatestQuote) return { data: { status: "refunded" }, event: "invoice.refunded" };
      return fallBack;
    case "FAILED":
      return {
        ...(isLatestQuote ? { data: { status: "failed" }, event: "invoice.failed" } : (fallBack ?? { data: {} })),
        alert: `A payment toward ${invoice.id} failed in the swap. A support case was opened; follow it in Support.`,
        supportCase: true,
      };
    default:
      return undefined;
  }
}

/** Stores what 1Click reported for the quote as a payment event. */
function recordEvent(tx: Prisma.TransactionClient, quote: Quote, response: StatusResponse) {
  const details = response.swapDetails;
  /** 1Click reports the refund fee on the quote, not in the swap details; the quote response stored with the address is the fallback. */
  const refundFee =
    response.status === "REFUNDED" ? (response.quoteResponse?.quote?.refundFee ?? (quote.rawResponse as QuoteResponse | null)?.quote?.refundFee) : undefined;
  return tx.paymentEvent.create({
    data: {
      id: newId("pev"),
      quoteId: quote.id,
      oneclickStatus: response.status,
      depositedAmount: details.depositedAmount ?? null,
      refundedAmount: details.refundedAmount ?? null,
      refundFee: refundFee ?? null,
      refundReason: details.refundReason ?? null,
      amountOut: details.amountOut ?? null,
      originTxs: details.originChainTxHashes ?? [],
      destinationTxs: details.destinationChainTxHashes ?? [],
    },
  });
}

/** The `payment` of an invoice event: none for invoice.expired, the latest quote's for a fall back to its state, else the quote that changed. */
async function eventPayment(tx: Prisma.TransactionClient, change: Transition, quote: Quote, event: PaymentEvent, latest: Quote | null, destinationChain: string) {
  if (change.event === "invoice.expired") return {};
  if (!change.restored || !latest) return { payment: serializePayment(quote, event, destinationChain) };
  const latestEvent = await tx.paymentEvent.findFirst({ where: { quoteId: latest.id }, orderBy: { receivedAt: "desc" } });
  return { payment: serializePayment(latest, latestEvent, destinationChain) };
}

async function apply(tx: Prisma.TransactionClient, quote: Quote & { invoice: Invoice & { merchant: Merchant } }, response: StatusResponse) {
  const status = response.status;
  const details = response.swapDetails;
  const event = await recordEvent(tx, quote, response);

  const latest = await tx.quote.findFirst({ where: { invoiceId: quote.invoiceId, createdAt: { gt: quote.createdAt } }, orderBy: { createdAt: "desc" } });
  /** Only a success needs it; the event just stored counts too, so a deposit first seen in this update gives the current time. */
  const firstDeposit =
    status === "SUCCESS"
      ? await tx.paymentEvent.findFirst({
          where: { quoteId: quote.id, oneclickStatus: { not: "PENDING_DEPOSIT" } },
          orderBy: { receivedAt: "asc" },
          select: { receivedAt: true },
        })
      : null;
  const ends = status === "INCOMPLETE_DEPOSIT" || status === "REFUNDED" || status === "FAILED";
  const othersMoving =
    ends && (await tx.quote.count({ where: { invoiceId: quote.invoiceId, id: { not: quote.id }, oneclickStatus: { in: [...MOVING].filter((moving) => moving !== "INCOMPLETE_DEPOSIT") } } })) > 0;
  const change = transition(quote.invoice, quote, status, latest, firstDeposit?.receivedAt ?? event.receivedAt, othersMoving);
  if (!change) return;

  const invoice = await tx.invoice.update({ where: { id: quote.invoiceId }, data: change.data });
  const merchant = quote.invoice.merchant;

  if (invoice.status === "paid" && invoice.creditAccountId && !invoice.creditedAt) {
    await tx.creditAccount.update({ where: { id: invoice.creditAccountId }, data: { balance: { increment: invoice.amount } } });
    await tx.invoice.update({ where: { id: invoice.id }, data: { creditedAt: new Date() } });
  }
  if (change.event === "invoice.paid") {
    await createSplitPayouts(tx, invoice);
    /** Other open deposit addresses are retired (still watched) so checkouts stop showing them; a payment still reaching one is an extra payment. */
    await retireOpenQuotes(tx, invoice.id, quote.id);
  }
  const updatedQuote = { ...quote, oneclickStatus: status };

  if (change.supportCase) {
    await tx.supportCase.create({
      data: {
        id: newId("case"),
        invoiceId: invoice.id,
        quoteId: quote.id,
        txHash: details.originChainTxHashes?.[0]?.hash ?? quote.depositTxHash,
        chain: quote.originChain,
        kind: "swap_failed",
        report: { correlation_id: quote.correlationId, deposit_address: quote.depositAddress, deposit_memo: quote.depositMemo, quote_signature: quote.signature },
      },
    });
  }
  if (change.alert) {
    /** A fall back's event names the invoice's new status, not this failed swap, so its alert keeps the payment kind. */
    await createAlert(merchant.id, change.event && !change.restored ? change.event : "payment", change.alert, tx);
  }
  if (change.event) {
    await enqueueWebhook(tx, merchant, invoice.mode, change.event, {
      invoice: serializeInvoice(invoice),
      ...(await eventPayment(tx, change, updatedQuote, event, latest, invoice.destinationChain)),
    });
  }
}

/** Records a 1Click status for a quote and moves its invoice forward; an event is stored when the status changes or an underpaid deposit grows. */
export async function applyStatus(quoteId: string, response: StatusResponse): Promise<void> {
  await getDb().$transaction(async (tx) => {
    /** The worker and a customer's deposit report can apply statuses at the same time; the invoice lock makes them take turns. */
    const { invoiceId } = await tx.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { invoiceId: true } });
    await lockInvoice(tx, invoiceId);
    const quote = await tx.quote.findUniqueOrThrow({ where: { id: quoteId }, include: { invoice: { include: { merchant: true } } } });
    /** A slower request can bring an older status after the quote already finished; a final status never changes. */
    if (FINAL.has(quote.oneclickStatus)) return;
    const updatedAt = new Date(response.updatedAt);
    const reportedAt = Number.isNaN(updatedAt.getTime()) ? null : updatedAt;
    const outdated =
      STATUS_RANK[response.status] < STATUS_RANK[quote.oneclickStatus] || (!!reportedAt && !!quote.oneclickUpdatedAt && reportedAt < quote.oneclickUpdatedAt);
    if (outdated) {
      /** The quote never moves backwards; it is only checked again on its usual schedule. */
      await tx.quote.update({ where: { id: quote.id }, data: { nextPollAt: new Date(Date.now() + nextPollDelay(quote, quote.oneclickStatus)) } });
      return;
    }
    const changed = quote.oneclickStatus !== response.status;
    const final = FINAL.has(response.status);

    await tx.quote.update({
      where: { id: quote.id },
      data: {
        oneclickStatus: response.status,
        ...(reportedAt ? { oneclickUpdatedAt: reportedAt } : {}),
        state: final ? "final" : quote.state,
        nextPollAt: new Date(Date.now() + nextPollDelay(quote, response.status)),
      },
    });
    if (changed) {
      await apply(tx, quote, response);
      await notifyCheckout(tx, quote.invoiceId);
    } else if (response.status === "INCOMPLETE_DEPOSIT") {
      /** Topping up an underpaid deposit keeps the status but raises the amount; it is stored so the checkout and payment show what arrived. */
      const last = await tx.paymentEvent.findFirst({ where: { quoteId: quote.id }, orderBy: { receivedAt: "desc" }, select: { depositedAmount: true } });
      if ((response.swapDetails.depositedAmount ?? null) !== (last?.depositedAmount ?? null)) {
        await recordEvent(tx, quote, response);
        await notifyCheckout(tx, quote.invoiceId);
      }
    }
  });
}
