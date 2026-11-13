import { z } from "zod";
import type { Merchant, Subscription } from "@/generated/prisma/client";
import { ApiError } from "@/lib/api/errors";
import { getDb } from "@/lib/db";
import { EmailRejectedError, emailEnabled, sendEmail } from "@/lib/email/send";
import { invoiceEmail } from "@/lib/email/templates";
import { reportError } from "@/lib/error-reports";
import type { Currency } from "@/lib/fx";
import { newId } from "@/lib/ids";
import { invoiceData } from "@/lib/invoices/create";
import { currencySchema, fiatAmountSchema, INVOICE_LIFETIME_SECONDS } from "@/lib/invoices/schema";
import { serializeInvoice } from "@/lib/invoices/serialize";
import { errorMessage, logger } from "@/lib/logger";
import { createAlert } from "@/lib/merchants/alerts";
import { DAY_MS, HOUR_MS } from "@/lib/time";
import { lockMerchant } from "@/lib/row-locks";
import { enqueueWebhook } from "@/lib/webhooks/events";

const log = logger.child({ module: "subscriptions" });

/** Wait before trying again to invoice a subscription that failed. */
const FAILED_RETRY_MS = HOUR_MS;
/** Room to import an existing customer list in a day, while still bounding the emails one business can trigger. */
const MAX_NEW_PER_DAY = 500;
/** Daily limit before a first live payment: anyone can open a business, and each subscription emails a stranger in its name. */
const MAX_NEW_PER_DAY_UNPAID = 10;
const MAX_ACTIVE = 2000;
const INVOICE_BATCH = 50;
const EMAIL_BATCH = 20;
/** How long one worker run keeps taking new batches before it leaves the rest for the next run. */
const WORKER_RUN_BUDGET_MS = 25_000;
/** Pay-link emails one address receives in 24 hours, across all businesses; later ones are skipped. */
const MAX_PAY_LINKS_PER_RECIPIENT_PER_DAY = 10;

export const createSubscriptionSchema = z.strictObject({
  customer_email: z.email({ error: "customer_email must be a valid email address." }),
  amount: fiatAmountSchema({ example: "9.00" }),
  currency: currencySchema,
  interval: z.enum(["week", "month"], { error: 'interval must be "week" or "month".' }),
  description: z.string().max(200).optional(),
});

export function serializeSubscription(subscription: Subscription) {
  return {
    id: subscription.id,
    object: "subscription",
    status: subscription.status,
    customer_email: subscription.customerEmail,
    amount: subscription.amount.toFixed(2),
    currency: subscription.currency,
    interval: subscription.interval,
    description: subscription.description,
    next_invoice_at: subscription.nextInvoiceAt.toISOString(),
    created_at: subscription.createdAt.toISOString(),
  };
}

/** Creates a subscription the worker invoices at once and then each interval, always with live invoices; the merchant lock keeps
    the daily and active limits exact. */
export function createSubscription(merchant: Merchant, input: z.infer<typeof createSubscriptionSchema>): Promise<Subscription> {
  return getDb().$transaction(async (tx) => {
    await lockMerchant(tx, merchant.id);
    const [today, active, paid] = await Promise.all([
      tx.subscription.count({ where: { merchantId: merchant.id, createdAt: { gte: new Date(Date.now() - DAY_MS) } } }),
      tx.subscription.count({ where: { merchantId: merchant.id, status: "active" } }),
      tx.invoice.findFirst({ where: { merchantId: merchant.id, mode: "live", status: "paid" }, select: { id: true } }),
    ]);
    if (!paid && today >= MAX_NEW_PER_DAY_UNPAID) {
      throw new ApiError(
        409,
        "invalid_state",
        `Until your business receives its first payment, it can create at most ${MAX_NEW_PER_DAY_UNPAID} subscriptions in 24 hours. Try again tomorrow.`,
      );
    }
    if (today >= MAX_NEW_PER_DAY) throw new ApiError(409, "invalid_state", `A business can create at most ${MAX_NEW_PER_DAY} subscriptions in 24 hours. Try again tomorrow.`);
    if (active >= MAX_ACTIVE) throw new ApiError(409, "invalid_state", `A business can have at most ${MAX_ACTIVE} active subscriptions. Cancel some first.`);
    return tx.subscription.create({
      data: {
        id: newId("sub"),
        merchantId: merchant.id,
        customerEmail: input.customer_email,
        amount: input.amount,
        currency: input.currency,
        interval: input.interval,
        description: input.description ?? null,
        nextInvoiceAt: new Date(),
      },
    });
  });
}

/** The billing date one interval after `from`; a monthly date keeps `billingDay`, or the month's last day when the month is shorter. */
function nextDate(from: Date, interval: Subscription["interval"], billingDay: number): Date {
  if (interval === "week") return new Date(from.getTime() + 7 * DAY_MS);
  const next = new Date(from);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(billingDay, lastDay));
  return next;
}

/** The first billing date after `now`, so periods missed while the worker was down are skipped rather than billed in a burst. */
function nextDateAfter(subscription: Subscription, now: Date): Date {
  const billingDay = subscription.createdAt.getUTCDate();
  let next = nextDate(subscription.nextInvoiceAt, subscription.interval, billingDay);
  while (next <= now) next = nextDate(next, subscription.interval, billingDay);
  return next;
}

/** Creates the due invoice for one subscription; another run that claimed it first wins. */
async function invoiceSubscription(subscription: Subscription & { merchant: Merchant }): Promise<void> {
  const db = getDb();
  const data = await invoiceData(
    subscription.merchant,
    "live",
    {
      amount: subscription.amount.toFixed(2),
      currency: subscription.currency as Currency,
      description: subscription.description ?? `${subscription.interval === "week" ? "Weekly" : "Monthly"} subscription`,
      customer_email: subscription.customerEmail,
      /** Subscription invoices stay payable for the longest lifetime the API allows, one day. */
      expires_in: INVOICE_LIFETIME_SECONDS.max,
    },
    { subscriptionId: subscription.id },
    false,
  );
  await db.$transaction(async (tx) => {
    const claimed = await tx.subscription.updateMany({
      where: { id: subscription.id, status: "active", nextInvoiceAt: subscription.nextInvoiceAt },
      data: { nextInvoiceAt: nextDateAfter(subscription, new Date()), invoiceRetryAt: null },
    });
    if (claimed.count === 0) return;
    const created = await tx.invoice.create({ data });
    await enqueueWebhook(tx, subscription.merchant, created.mode, "subscription.invoice_created", { invoice: serializeInvoice(created) });
  });
}

/** Puts off a failed subscription without moving its billing date; the first failure in a row alerts the business; errors other than ApiError are reported. */
async function retryLater(subscription: Subscription, error: unknown): Promise<void> {
  log.error({ subscription: subscription.id, error: errorMessage(error) }, "Invoicing failed");
  if (!(error instanceof ApiError)) reportError(error, { job: "subscriptions", subscription: subscription.id });
  const db = getDb();
  await db.subscription.updateMany({ where: { id: subscription.id, status: "active", nextInvoiceAt: subscription.nextInvoiceAt }, data: { invoiceRetryAt: new Date(Date.now() + FAILED_RETRY_MS) } });
  if (subscription.invoiceRetryAt === null) {
    const reason = error instanceof ApiError ? error.message : "Solverr could not create the invoice.";
    await createAlert(subscription.merchantId, "subscription_failed", `Subscription ${subscription.id} could not be billed: ${reason} Solverr tries again every hour.`);
  }
}

/** Worker job: invoices due active subscriptions in batches until none is due or WORKER_RUN_BUDGET_MS is used, so month-start peaks bill on time. */
export async function invoiceDueSubscriptions(signal: AbortSignal): Promise<number> {
  const db = getDb();
  const started = Date.now();
  let total = 0;
  while (!signal.aborted && Date.now() - started < WORKER_RUN_BUDGET_MS) {
    const now = new Date();
    /** Takes each business's oldest due subscription first, then each one's second, so one business's backlog cannot hold up the rest. */
    const ranked = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM (
        SELECT id, next_invoice_at, ROW_NUMBER() OVER (PARTITION BY merchant_id ORDER BY next_invoice_at) AS merchant_rank
        FROM subscriptions
        WHERE status = 'active' AND next_invoice_at <= ${now} AND (invoice_retry_at IS NULL OR invoice_retry_at <= ${now})
      ) ranked
      ORDER BY merchant_rank, next_invoice_at
      LIMIT ${INVOICE_BATCH}`;
    const due = await db.subscription.findMany({ where: { id: { in: ranked.map((row) => row.id) } }, include: { merchant: true }, orderBy: { nextInvoiceAt: "asc" } });
    for (const subscription of due) {
      if (signal.aborted) break;
      await invoiceSubscription(subscription).catch((error: unknown) => retryLater(subscription, error));
    }
    total += due.length;
    if (due.length < INVOICE_BATCH) break;
  }
  return total;
}

/** Worker job: emails each unsent pay link of active subscriptions once (idempotency key), businesses taking turns;
    an address past MAX_PAY_LINKS_PER_RECIPIENT_PER_DAY is skipped, so one inbox cannot be flooded. */
export async function sendSubscriptionPayLinks(signal: AbortSignal): Promise<number> {
  if (!emailEnabled()) return 0;
  const db = getDb();
  const ranked = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM (
      SELECT i.id, i.created_at, ROW_NUMBER() OVER (PARTITION BY i.merchant_id ORDER BY i.created_at) AS merchant_rank
      FROM invoices i JOIN subscriptions s ON s.id = i.subscription_id
      WHERE i.mode = 'live' AND i.customer_email IS NOT NULL AND i.pay_link_sent_at IS NULL
        AND i.status IN ('created', 'awaiting_payment') AND i.expires_at > ${new Date()} AND s.status = 'active'
    ) ranked
    ORDER BY merchant_rank, created_at
    LIMIT ${EMAIL_BATCH}`;
  const due = await db.invoice.findMany({
    where: { id: { in: ranked.map((row) => row.id) } },
    include: { merchant: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  for (const invoice of due) {
    if (signal.aborted) break;
    const markSent = () => db.invoice.updateMany({ where: { id: invoice.id, payLinkSentAt: null }, data: { payLinkSentAt: new Date() } });
    const recentlySent = await db.invoice.count({
      where: { payLinkSentAt: { gte: new Date(Date.now() - DAY_MS) }, customerEmail: { equals: invoice.customerEmail!, mode: "insensitive" } },
    });
    if (recentlySent >= MAX_PAY_LINKS_PER_RECIPIENT_PER_DAY) {
      log.warn({ invoice: invoice.id }, "Pay link not emailed; the customer reached the daily limit");
      await markSent();
      continue;
    }
    try {
      const { checkout_url } = serializeInvoice(invoice);
      await sendEmail(
        { to: invoice.customerEmail!, ...(await invoiceEmail({ merchantName: invoice.merchant.name, amount: invoice.amount.toFixed(2), currency: invoice.currency, payUrl: checkout_url, expiresAt: invoice.expiresAt })) },
        { idempotencyKey: `subscription-invoice/${invoice.id}` },
      );
      await markSent();
    } catch (error) {
      log.error({ invoice: invoice.id, error: errorMessage(error) }, "Pay link email failed");
      /** A refused message is marked handled so it stops holding back newer ones. */
      if (error instanceof EmailRejectedError) {
        await markSent();
        continue;
      }
      /** Any other failure (a bad key, an unverified domain, an outage) hits every message alike: report it and retry next run. */
      reportError(error);
      break;
    }
  }
  return due.length;
}
