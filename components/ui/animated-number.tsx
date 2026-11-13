"use client";

import NumberFlow from "@number-flow/react";

const FORMATS = {
  usd: { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 },
  /** Dollars shortened with K, M and B (truncated to 2 decimals, as `shortAmountFormat` in lib/format.ts), for tight spaces. */
  usdCompact: { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2, roundingMode: "trunc" },
  integer: { maximumFractionDigits: 0 },
  percent: { style: "percent", maximumFractionDigits: 0 },
} satisfies Record<string, Intl.NumberFormatOptions>;

export type NumberFormat = keyof typeof FORMATS;

/** Number that rolls its digits to a new value; `percent` takes 0–100. Respects reduced motion. */
export function AnimatedNumber({ value, format = "integer", suffix, className }: { value: number; format?: NumberFormat; suffix?: string; className?: string }) {
  return <NumberFlow value={format === "percent" ? value / 100 : value} format={FORMATS[format]} locales="en-US" suffix={suffix} className={className} />;
}
