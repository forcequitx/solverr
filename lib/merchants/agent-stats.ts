import type { Mode } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { share } from "@/lib/format";
import { AGENT_RESOURCE_KEY, dayLabel, periodEdges, resourceOf, settledUsd, STATS_ROW_LIMIT, tokenPrices, utcDate, utcDayStart } from "@/lib/merchants/stat-periods";
import { DAY_MS } from "@/lib/time";

const TOP_RESOURCES = 4;
/** How many of the newest agent invoices the Agents page loads. */
export const RECENT_PAYMENTS = 50;
const CREDIT_ACCOUNTS_SHOWN = 50;
const RECENT_USAGE = 5;
const AGENT_INVOICE = { metadata: { path: [AGENT_RESOURCE_KEY], not: "null" } };

export type AgentDay = { label: string; title: string; revenueUsd: number; payments: number };
export type AgentResource = { resource: string; payments: number; revenueUsd: number; share: number };
export type AgentPayment = { id: string; resource: string; amount: string; currency: string; status: string; createdAt: string };
export type CreditAccountRow = { id: string; balance: string; createdAt: string; usage: { id: string; amount: string; description: string | null; refunded: boolean }[] };

type AgentStats = {
  /** One entry per UTC day of the last 30 days that the read rows fully cover, oldest first. */
  days: AgentDay[];
  revenueUsd: number;
  /** Paid agent calls of the last 30 days, always exact; revenue, `days` and the routes count calls from `countedFrom` on. */
  payments: number;
  /** The first day revenue, `days` and the routes cover when there were more calls than the stats read; null when they cover all 30 days. */
  countedFrom: string | null;
  resources: AgentResource[];
  resourceCount: number;
  recent: AgentPayment[];
  credits: { accounts: number; balanceUsd: number; rows: CreditAccountRow[] };
};

/** Paid agent calls of the last 30 days in USD (settlement coin × current price, as on the overview), recent agent invoices, and credit accounts. */
export async function agentStats(merchantId: string, mode: Mode): Promise<AgentStats> {
  const starts = periodEdges("30d", utcDayStart()).slice(0, -1);
  const from = starts[0];
  const db = getDb();
  const paidWhere = { merchantId, mode, ...AGENT_INVOICE, status: "paid" as const, paidAt: { gte: new Date(from) } };
  const [paid, paidCount, recent, accounts, creditTotals, prices] = await Promise.all([
    db.invoice.findMany({
      where: paidWhere,
      orderBy: { paidAt: "desc" },
      take: STATS_ROW_LIMIT,
      select: { paidAt: true, amountOutBase: true, destinationAsset: true, destinationDecimals: true, metadata: true },
    }),
    db.invoice.count({ where: paidWhere }),
    db.invoice.findMany({
      where: { merchantId, mode, ...AGENT_INVOICE },
      orderBy: { createdAt: "desc" },
      take: RECENT_PAYMENTS,
      select: { id: true, amount: true, currency: true, status: true, createdAt: true, metadata: true },
    }),
    db.creditAccount.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
      take: CREDIT_ACCOUNTS_SHOWN,
      include: { usage: { orderBy: { createdAt: "desc" }, take: RECENT_USAGE } },
    }),
    db.creditAccount.aggregate({ where: { merchantId }, _count: { _all: true }, _sum: { balance: true } }),
    tokenPrices(),
  ]);

  /** At the row limit, the oldest day read may be only partly read, so revenue and routes start the day after it rather than undercounting. */
  const lastRead = paid.at(-1)?.paidAt;
  const firstCovered = paid.length === STATS_ROW_LIMIT && lastRead ? utcDayStart(lastRead) + DAY_MS : from;
  const days = starts.filter((start) => start >= firstCovered).map((start): AgentDay => ({ ...dayLabel(start), revenueUsd: 0, payments: 0 }));
  const byResource = new Map<string, { payments: number; revenueUsd: number }>();
  for (const invoice of paid) {
    const resource = resourceOf(invoice.metadata);
    if (!resource || !invoice.paidAt || invoice.paidAt.getTime() < firstCovered) continue;
    const usd = settledUsd(invoice, prices);
    const day = days[Math.floor((invoice.paidAt.getTime() - firstCovered) / DAY_MS)];
    if (day) {
      day.revenueUsd += usd;
      day.payments += 1;
    }
    const entry = byResource.get(resource) ?? { payments: 0, revenueUsd: 0 };
    byResource.set(resource, { payments: entry.payments + 1, revenueUsd: entry.revenueUsd + usd });
  }
  const revenueUsd = days.reduce((total, day) => total + day.revenueUsd, 0);
  const resources = [...byResource.entries()]
    .map(([resource, entry]) => ({ resource, ...entry, share: share(entry.revenueUsd, revenueUsd) }))
    .sort((a, b) => b.revenueUsd - a.revenueUsd || b.payments - a.payments);

  return {
    days,
    revenueUsd,
    payments: paidCount,
    countedFrom: firstCovered > from ? utcDate(firstCovered, { month: "short", day: "numeric" }) : null,
    resources: resources.slice(0, TOP_RESOURCES),
    resourceCount: resources.length,
    recent: recent.flatMap((invoice) => {
      const resource = resourceOf(invoice.metadata);
      return resource
        ? [{ id: invoice.id, resource, amount: invoice.amount.toFixed(2), currency: invoice.currency, status: invoice.status, createdAt: invoice.createdAt.toISOString() }]
        : [];
    }),
    credits: {
      accounts: creditTotals._count._all,
      balanceUsd: Number(creditTotals._sum.balance ?? 0),
      /** Credits are stored and charged with 6 decimals; `toFixed()` shows that exact value without trailing zeros ("0.050000" → "0.05"). */
      rows: accounts.map((account) => ({
        id: account.id,
        balance: account.balance.toFixed(),
        createdAt: account.createdAt.toISOString(),
        usage: account.usage.map((usage) => ({ id: usage.id, amount: usage.amount.toFixed(), description: usage.description, refunded: usage.refundedAt !== null })),
      })),
    },
  };
}
