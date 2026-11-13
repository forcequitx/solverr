import type { Subscription, SubscriptionInterval, SubscriptionStatus } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { type Currency, unitsPerUsd } from "@/lib/fx";
import { errorMessage, logger } from "@/lib/logger";

const log = logger.child({ module: "subscriptions" });
const WEEKS_PER_MONTH = 52 / 12;
/** How many of the newest subscriptions the dashboard list loads. */
export const SUBSCRIPTIONS_SHOWN = 200;
const UPCOMING_SHOWN = 5;

type SubscriptionTotals = {
  active: number;
  canceled: number;
  /** What active subscriptions bill in an average month, in USD at current ECB rates; a currency without a rate is left out. */
  monthlyUsd: number;
  invoices: number;
  paidInvoices: number;
};

export type SubscriptionRow = {
  id: string;
  email: string;
  description: string | null;
  amount: string;
  currency: string;
  interval: SubscriptionInterval;
  status: SubscriptionStatus;
  /** ISO time of the next invoice. */
  next: string;
  /** The next invoice time has passed; the worker creates it on its next run. */
  due: boolean;
  /** Invoices the subscription created, and how many of them are paid. */
  invoices: number;
  paid: number;
};

/** Subscription counts, expected monthly billing and the (always live) invoices subscriptions created; opens while the rate service is down. */
export async function subscriptionTotals(merchantId: string): Promise<SubscriptionTotals> {
  const db = getDb();
  const fromSubscriptions = { merchantId, subscriptionId: { not: null } };
  const [byStatus, activeSums, invoices, paidInvoices] = await Promise.all([
    db.subscription.groupBy({ by: ["status"], where: { merchantId }, _count: { _all: true } }),
    db.subscription.groupBy({ by: ["currency", "interval"], where: { merchantId, status: "active" }, _sum: { amount: true } }),
    db.invoice.count({ where: fromSubscriptions }),
    db.invoice.count({ where: { ...fromSubscriptions, status: "paid" } }),
  ]);
  const monthly = await Promise.all(
    activeSums.map(async (row) => {
      const rate = await unitsPerUsd(row.currency as Currency).catch((error: unknown) => {
        log.error({ currency: row.currency, error: errorMessage(error) }, "Currency rate unavailable for monthly billing");
        return null;
      });
      return rate ? (Number(row._sum.amount ?? 0) * (row.interval === "week" ? WEEKS_PER_MONTH : 1)) / rate : 0;
    }),
  );
  const count = (status: string) => byStatus.find((row) => row.status === status)?._count._all ?? 0;
  return { active: count("active"), canceled: count("canceled"), monthlyUsd: monthly.reduce((total, value) => total + value, 0), invoices, paidInvoices };
}

/** Invoices created and paid for each of the given subscriptions. */
async function invoiceCounts(merchantId: string, subscriptionIds: string[]): Promise<Map<string, Pick<SubscriptionRow, "invoices" | "paid">>> {
  const db = getDb();
  const where = { merchantId, subscriptionId: { in: subscriptionIds } };
  const [created, paid] = await Promise.all([
    db.invoice.groupBy({ by: ["subscriptionId"], where, _count: { _all: true } }),
    db.invoice.groupBy({ by: ["subscriptionId"], where: { ...where, status: "paid" }, _count: { _all: true } }),
  ]);
  const paidBySubscription = new Map(paid.map((row) => [row.subscriptionId, row._count._all]));
  return new Map(created.map((row) => [row.subscriptionId!, { invoices: row._count._all, paid: paidBySubscription.get(row.subscriptionId) ?? 0 }]));
}

/** The newest subscriptions and the active ones with the soonest next invoice, with their invoice counts. */
export async function subscriptionLists(merchantId: string): Promise<{ rows: SubscriptionRow[]; upcoming: SubscriptionRow[] }> {
  const db = getDb();
  const [newest, soonest] = await Promise.all([
    db.subscription.findMany({ where: { merchantId }, orderBy: { createdAt: "desc" }, take: SUBSCRIPTIONS_SHOWN }),
    db.subscription.findMany({ where: { merchantId, status: "active" }, orderBy: { nextInvoiceAt: "asc" }, take: UPCOMING_SHOWN }),
  ]);
  const counts = await invoiceCounts(merchantId, [...new Set([...newest, ...soonest].map((subscription) => subscription.id))]);
  const now = Date.now();
  const toRow = (subscription: Subscription): SubscriptionRow => ({
    id: subscription.id,
    email: subscription.customerEmail,
    description: subscription.description,
    amount: subscription.amount.toFixed(2),
    currency: subscription.currency,
    interval: subscription.interval,
    status: subscription.status,
    next: subscription.nextInvoiceAt.toISOString(),
    due: subscription.status === "active" && subscription.nextInvoiceAt.getTime() <= now,
    ...(counts.get(subscription.id) ?? { invoices: 0, paid: 0 }),
  });
  return { rows: newest.map(toRow), upcoming: soonest.map(toRow) };
}
