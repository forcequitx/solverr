import { formatBaseUnits } from "@/lib/money";
import { displayTokens } from "@/lib/oneclick/tokens";
import { DAY_MS } from "@/lib/time";

/** Invoices created by the x402 paywall carry the method and path they pay for under this metadata key. */
export const AGENT_RESOURCE_KEY = "solverr_resource";

/** The most rows a stats query reads for its per-day split; a query that reaches it must say which days it fully covers. */
export const STATS_ROW_LIMIT = 5000;

export type Period = "7d" | "30d" | "12m";

/** The UTC date of `time` formatted in US English with `options`. */
export const utcDate = (time: number, options: Intl.DateTimeFormatOptions) => new Date(time).toLocaleDateString("en-US", { timeZone: "UTC", ...options });

/** Start of the UTC day that contains `now`, in milliseconds. */
export function utcDayStart(now = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** The method and path an agent invoice pays for, or null for any other invoice. */
export function resourceOf(metadata: unknown): string | null {
  const resource = ((metadata ?? {}) as Record<string, unknown>)[AGENT_RESOURCE_KEY];
  return typeof resource === "string" ? resource : null;
}

/** Current USD price of every 1Click token by asset ID. */
export const tokenPrices = () => displayTokens().then((tokens) => new Map(tokens.map((token) => [token.assetId, token.price])));

/** USD value of an invoice's settlement amount at the current price of its settlement coin. */
export function settledUsd(invoice: { amountOutBase: string; destinationDecimals: number; destinationAsset: string }, prices: Map<string, number>): number {
  return Number(formatBaseUnits(BigInt(invoice.amountOutBase), invoice.destinationDecimals)) * (prices.get(invoice.destinationAsset) ?? 0);
}

/** Short and full UTC labels of the day starting at `start`, such as "Nov 6" and "Nov 6, 2026". */
export function dayLabel(start: number): { label: string; title: string } {
  return { label: utcDate(start, { month: "short", day: "numeric" }), title: utcDate(start, { month: "short", day: "numeric", year: "numeric" }) };
}

/** Bucket start times for a period plus the end of the last bucket, in UTC: days for 7 and 30 days, months for 12 months. */
export function periodEdges(period: Period, todayStart: number): number[] {
  if (period === "12m") {
    const today = new Date(todayStart);
    return Array.from({ length: 13 }, (_, index) => Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11 + index, 1));
  }
  const days = period === "7d" ? 7 : 30;
  return Array.from({ length: days + 1 }, (_, index) => todayStart - (days - 1 - index) * DAY_MS);
}

/** Axis label and tooltip title of the bucket starting at `start`: weekday for 7 days, day for 30 days, month for 12 months. */
export function bucketLabel(period: Period, start: number): { label: string; title: string } {
  if (period === "12m") return { label: utcDate(start, { month: "short" }), title: utcDate(start, { month: "long", year: "numeric" }) };
  const day = dayLabel(start);
  return period === "7d" ? { ...day, label: utcDate(start, { weekday: "short" }) } : day;
}
