import type { InvoiceStatus, Mode } from "@/generated/prisma/client";
import { getChain } from "@/lib/chains/registry";
import { getDb } from "@/lib/db";
import { share } from "@/lib/format";
import { OPEN_STATUSES } from "@/lib/invoices/statuses";
import { bucketLabel, periodEdges, type Period, resourceOf, settledUsd, STATS_ROW_LIMIT, tokenPrices, utcDate, utcDayStart } from "@/lib/merchants/stat-periods";
import { DAY_MS } from "@/lib/time";

const KPI_DAYS = 7;
const CHAIN_DAYS = 30;
const HEATMAP_WEEKS = 53;
const HEAT_LEVELS = 5;
const MONTH_LABEL_MIN_COLUMNS = 3;

export type Bucket = {
  label: string;
  title: string;
  /** Paid revenue by payment date. */
  revenueUsd: number;
  /** Checkouts created in the bucket, and how many of those are paid. */
  checkouts: number;
  checkoutsPaid: number;
};

export type PeriodStats = {
  buckets: Bucket[];
  revenueUsd: number;
  /** Null when the previous period reaches past the rows the query returned. */
  previousRevenueUsd: number | null;
  checkouts: number;
  checkoutsPaid: number;
  previousCheckoutsPaid: number | null;
  /** Checkouts with a final status; open ones are left out. */
  finished: number;
  paidFirstTry: number;
  refunds: number;
  expiredOrFailed: number;
};

export type ChainShare = { id: string; name: string; payments: number; revenueUsd: number; share: number };

type HeatmapDay = { title: string; level: number };

export type Heatmap = {
  /** Columns of seven days, Sunday first; days after today are null. */
  weeks: (HeatmapDay | null)[][];
  months: { label: string; column: number }[];
  total: number;
};

type OverviewData = {
  periods: Record<Period, PeriodStats>;
  kpis: {
    revenueUsd: number;
    previousRevenueUsd: number | null;
    payments: number;
    previousPayments: number | null;
    agentPayments: number;
    previousAgentPayments: number | null;
    openCases: number;
  };
  chains: ChainShare[];
  heatmap: Heatmap;
};

type InvoiceFact = {
  createdAt: number;
  /** Payment time, only for paid invoices. */
  paidAt: number | null;
  status: InvoiceStatus;
  usd: number;
  chainId: string | null;
  agent: boolean;
  firstTry: boolean;
};

const within = (time: number | null, from: number, to: number) => time !== null && time >= from && time < to;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** Start of the period of the same length just before `edges`. */
function previousStart(period: Period, edges: number[]): number {
  if (period !== "12m") return edges[0] - (edges.length - 1) * DAY_MS;
  const first = new Date(edges[0]);
  return Date.UTC(first.getUTCFullYear() - 1, first.getUTCMonth(), 1);
}

function paidSummary(facts: InvoiceFact[], from: number, to: number) {
  const paid = facts.filter((fact) => within(fact.paidAt, from, to));
  return { revenueUsd: sum(paid.map((fact) => fact.usd)), payments: paid.length, agentPayments: paid.filter((fact) => fact.agent).length };
}

function checkoutSummary(facts: InvoiceFact[], from: number, to: number) {
  const created = facts.filter((fact) => within(fact.createdAt, from, to));
  const count = (statuses: InvoiceStatus[]) => created.filter((fact) => statuses.includes(fact.status)).length;
  return {
    checkouts: created.length,
    checkoutsPaid: count(["paid"]),
    finished: created.filter((fact) => !OPEN_STATUSES.has(fact.status)).length,
    paidFirstTry: created.filter((fact) => fact.status === "paid" && fact.firstTry).length,
    refunds: count(["underpaid", "refunded"]),
    expiredOrFailed: count(["expired", "failed"]),
  };
}

function periodStats(facts: InvoiceFact[], period: Period, todayStart: number, coveredFrom: number): PeriodStats {
  const edges = periodEdges(period, todayStart);
  const [from, to] = [edges[0], edges[edges.length - 1]];
  const previousFrom = previousStart(period, edges);
  const comparable = previousFrom >= coveredFrom;
  const buckets = edges.slice(0, -1).map((start, index): Bucket => {
    const created = checkoutSummary(facts, start, edges[index + 1]);
    return { ...bucketLabel(period, start), revenueUsd: paidSummary(facts, start, edges[index + 1]).revenueUsd, checkouts: created.checkouts, checkoutsPaid: created.checkoutsPaid };
  });
  return {
    buckets,
    ...checkoutSummary(facts, from, to),
    revenueUsd: sum(buckets.map((bucket) => bucket.revenueUsd)),
    previousRevenueUsd: comparable ? paidSummary(facts, previousFrom, from).revenueUsd : null,
    previousCheckoutsPaid: comparable ? checkoutSummary(facts, previousFrom, from).checkoutsPaid : null,
  };
}

function kpiNumbers(facts: InvoiceFact[], todayStart: number, coveredFrom: number) {
  const to = todayStart + DAY_MS;
  const from = to - KPI_DAYS * DAY_MS;
  const previousFrom = from - KPI_DAYS * DAY_MS;
  const current = paidSummary(facts, from, to);
  const previous = previousFrom >= coveredFrom ? paidSummary(facts, previousFrom, from) : null;
  return {
    ...current,
    previousRevenueUsd: previous?.revenueUsd ?? null,
    previousPayments: previous?.payments ?? null,
    previousAgentPayments: previous?.agentPayments ?? null,
  };
}

/** Paid revenue over the last 30 days by the chain the customer paid from, largest first. */
function chainShares(facts: InvoiceFact[], todayStart: number): ChainShare[] {
  const to = todayStart + DAY_MS;
  const byChain = new Map<string, { payments: number; revenueUsd: number }>();
  for (const fact of facts) {
    if (!within(fact.paidAt, to - CHAIN_DAYS * DAY_MS, to)) continue;
    const id = fact.chainId ?? "unknown";
    const entry = byChain.get(id) ?? { payments: 0, revenueUsd: 0 };
    byChain.set(id, { payments: entry.payments + 1, revenueUsd: entry.revenueUsd + fact.usd });
  }
  const total = sum([...byChain.values()].map((entry) => entry.revenueUsd));
  return [...byChain.entries()]
    .map(([id, entry]) => ({ id, name: getChain(id)?.name ?? (id === "unknown" ? "Unknown chain" : id), ...entry, share: share(entry.revenueUsd, total) }))
    .sort((a, b) => b.revenueUsd - a.revenueUsd || b.payments - a.payments);
}

/** Paid payments per UTC day for the last 53 weeks, with levels from the share of busy days at or below each count. */
function paidHeatmap(facts: InvoiceFact[], todayStart: number): Heatmap {
  const firstDay = todayStart - (new Date(todayStart).getUTCDay() + (HEATMAP_WEEKS - 1) * 7) * DAY_MS;
  const counts = new Map<number, number>();
  for (const fact of facts) {
    if (!within(fact.paidAt, firstDay, todayStart + DAY_MS)) continue;
    const day = Math.floor((fact.paidAt! - firstDay) / DAY_MS);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const busy = [...counts.values()];
  const level = (count: number) => (count === 0 ? 0 : Math.max(1, Math.ceil((busy.filter((value) => value <= count).length / busy.length) * HEAT_LEVELS)));

  const weeks = Array.from({ length: HEATMAP_WEEKS }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday): HeatmapDay | null => {
      const day = week * 7 + weekday;
      const time = firstDay + day * DAY_MS;
      if (time > todayStart) return null;
      const count = counts.get(day) ?? 0;
      return { title: `${utcDate(time, { month: "short", day: "numeric", year: "numeric" })} · ${count} paid`, level: level(count) };
    }),
  );

  const months: Heatmap["months"] = [];
  for (let column = 0; column < HEATMAP_WEEKS; column += 1) {
    const time = firstDay + column * 7 * DAY_MS;
    if (column === 0 || new Date(time).getUTCMonth() !== new Date(time - 7 * DAY_MS).getUTCMonth()) months.push({ label: utcDate(time, { month: "short" }), column });
  }
  /** The first label is dropped when its month shows for too few columns to fit the name. */
  if (months.length > 1 && months[1].column - months[0].column < MONTH_LABEL_MIN_COLUMNS) months.shift();

  return { weeks, months, total: sum(busy) };
}

/** The merchant's invoices of the last 24 months as facts, with today's UTC start and the earliest time the rows fully cover. */
async function invoiceFacts(merchantId: string, mode: Mode): Promise<{ facts: InvoiceFact[]; todayStart: number; coveredFrom: number }> {
  const now = new Date();
  const todayStart = utcDayStart(now);
  /** Covers the previous 12 months for comparison, which also covers the 53-week heatmap. */
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 23, 1));
  const [invoices, prices] = await Promise.all([
    getDb().invoice.findMany({
      where: { merchantId, mode, OR: [{ createdAt: { gte: since } }, { paidAt: { gte: since } }] },
      orderBy: { createdAt: "desc" },
      take: STATS_ROW_LIMIT,
      select: {
        createdAt: true,
        paidAt: true,
        status: true,
        amountOutBase: true,
        destinationAsset: true,
        destinationDecimals: true,
        metadata: true,
        paidQuoteId: true,
        quotes: { select: { id: true, originChain: true }, orderBy: { createdAt: "asc" } },
      },
    }),
    tokenPrices(),
  ]);

  const facts = invoices.map((invoice): InvoiceFact => {
    const paid = invoice.status === "paid" && invoice.paidAt !== null;
    return {
      createdAt: invoice.createdAt.getTime(),
      paidAt: paid ? invoice.paidAt!.getTime() : null,
      status: invoice.status,
      usd: paid ? settledUsd(invoice, prices) : 0,
      chainId: invoice.quotes.find((quote) => quote.id === invoice.paidQuoteId)?.originChain ?? null,
      agent: resourceOf(invoice.metadata) !== null,
      firstTry: invoice.paidQuoteId !== null && invoice.paidQuoteId === invoice.quotes[0]?.id,
    };
  });
  /** When the row limit is reached, comparisons only use periods the returned rows fully cover. */
  const coveredFrom = invoices.length < STATS_ROW_LIMIT ? since.getTime() : (facts.at(-1)?.createdAt ?? since.getTime());
  return { facts, todayStart, coveredFrom };
}

function allPeriods(facts: InvoiceFact[], todayStart: number, coveredFrom: number): Record<Period, PeriodStats> {
  return {
    "7d": periodStats(facts, "7d", todayStart, coveredFrom),
    "30d": periodStats(facts, "30d", todayStart, coveredFrom),
    "12m": periodStats(facts, "12m", todayStart, coveredFrom),
  };
}

/** Checkouts and paid revenue per period, without the rest of the overview. */
export async function paymentPeriods(merchantId: string, mode: Mode): Promise<Record<Period, PeriodStats>> {
  const { facts, todayStart, coveredFrom } = await invoiceFacts(merchantId, mode);
  return allPeriods(facts, todayStart, coveredFrom);
}

/** Everything the overview page shows: checkouts, paid revenue in USD (settlement coin × current price), chains, and daily activity. */
export async function overviewData(merchantId: string, mode: Mode): Promise<OverviewData> {
  const [{ facts, todayStart, coveredFrom }, openCases] = await Promise.all([
    invoiceFacts(merchantId, mode),
    getDb().supportCase.count({ where: { status: "open", invoice: { merchantId, mode } } }),
  ]);

  return {
    periods: allPeriods(facts, todayStart, coveredFrom),
    kpis: { ...kpiNumbers(facts, todayStart, coveredFrom), openCases },
    chains: chainShares(facts, todayStart),
    heatmap: paidHeatmap(facts, todayStart),
  };
}
