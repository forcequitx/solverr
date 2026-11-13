const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const USD_COMPACT = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const USD_CENTS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const formatUsd = (value: number) => USD.format(value);

/** Axis-style dollars: $0, $0.25, $500, $2K, $1.5M; cents show below $1, so ticks there stay distinct. */
export const formatUsdCompact = (value: number) => (Math.abs(value) < 1 ? USD_CENTS : USD_COMPACT).format(value);

const TWO_DECIMALS = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;
/** Cut, not rounded, so a shortened amount never reads as more than it is (99,999,999.99 is 99.99M, not 100M). */
const COMPACT = { notation: "compact", maximumFractionDigits: 2, roundingMode: "trunc" } as const;
/** From this amount up, an amount shown in a tight spot is shortened with K, M, B or T. */
const COMPACT_FROM = 100_000;

/** Number format for an amount in a tight spot: 1,250.00 below 100,000, and 125K, 1.25M or 2.5B from there up. */
export const shortAmountFormat = (value: number) => (value >= COMPACT_FROM ? COMPACT : TWO_DECIMALS);

/** An amount for a tight spot such as a headline or a card: 1,250.00, or 1.25M from 100,000 up. */
export const formatShortAmount = (value: number | string) => Number(value).toLocaleString("en-US", shortAmountFormat(Number(value)));

/** Fraction digits per group in a long exact amount, such as an 18- or 24-decimal coin's. */
const FRACTION_GROUP = 6;

/** An exact amount split so it wraps only between groups of 6 fraction digits ("1.392073", "897954", …); short ones stay whole. */
export function amountGroups(amount: string): string[] {
  const [whole, fraction = ""] = amount.split(".");
  if (fraction.length <= FRACTION_GROUP + 2) return [amount];
  const groups = fraction.match(new RegExp(`.{1,${FRACTION_GROUP}}`, "g")) ?? [fraction];
  return [`${whole}.${groups[0]}`, ...groups.slice(1)];
}

/** An exact amount with thousands separators, such as 1,250,000.00, for receipts and sentences. */
export const formatAmount = (value: number | string) => Number(value).toLocaleString("en-US", TWO_DECIMALS);

/** An exact amount followed by its currency code, such as 1,250.00 USD. */
export const formatCurrencyAmount = (value: number | string, currency: string) => `${formatAmount(value)} ${currency}`;

/** The approximate coin amount for a USD price: two decimals from 1 up, four significant digits below. */
export function coinAmount(usd: number, coin: { priceUsd: number }): string {
  const amount = usd / coin.priceUsd;
  return amount.toLocaleString("en-US", amount >= 1 ? TWO_DECIMALS : { maximumSignificantDigits: 4 });
}

/** Whole count with thousands separators, such as 1,204, for chart tooltips. */
export const formatCount = (value: unknown) => Number(value).toLocaleString("en-US");

/** Short date in UTC, such as "Nov 6, 2026", so the server and the browser render the same text. */
export const formatUtcDate = (date: Date | string) => new Date(date).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

/** Date and time in UTC, such as "Nov 6, 2026, 14:05 UTC", so the server and the browser render the same text. */
export const formatUtcDateTime = (date: Date | string) =>
  `${new Date(date).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} UTC`;

/** A wait in words, such as "45 seconds" or "3 minutes": seconds up to a minute, then whole minutes rounded up. */
export function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/** Whole percent that `part` is of `whole`; 0 when `whole` is 0. */
export const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** Two-letter avatar text in any script: the first letters of the first two words, or the first two letters of one word. */
export function initials(text: string): string {
  /** Apostrophes join a word ("Let's" stays one word), so "Let's do" gives "LD". */
  const words = text
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean)
    .map((word) => Array.from(word));
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? ["?"]).slice(0, 2).join("");
  return letters.toUpperCase();
}
