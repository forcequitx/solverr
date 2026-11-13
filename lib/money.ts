const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

/** A price in USD, EUR or INR as forms and the API take it: up to 12 digits and 2 decimals, such as "25.00". */
export const FIAT_AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;
/** The largest amount `FIAT_AMOUNT_PATTERN` accepts, written for messages. */
export const FIAT_AMOUNT_MAX = "999,999,999,999.99";

/** A dollar minimum for messages: "$1,000" or "$4.84". */
export function formatMinimumUsd(usd: number): string {
  return `$${usd.toLocaleString("en-US", Number.isInteger(usd) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Converts a non-negative decimal string to integer base units, dropping digits beyond `decimals`. */
export function toBaseUnits(value: string, decimals: number): bigint {
  if (!DECIMAL_PATTERN.test(value)) throw new Error(`Not a decimal number: ${value}`);
  const [whole, fraction = ""] = value.split(".");
  const padded = fraction.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole + padded);
}

/** Formats integer base units as a decimal string without trailing zeros. */
export function formatBaseUnits(base: bigint, decimals: number): string {
  const digits = base.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Decimal places `numberToDecimal` keeps; prices and rates finer than this round to zero. */
const NUMBER_DECIMALS = 12;

/** Converts a JavaScript number (such as an API price or rate) to a plain decimal string. */
export function numberToDecimal(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid number: ${value}`);
  return value.toFixed(NUMBER_DECIMALS).replace(/\.?0+$/, "");
}

/** Computes a * b / c rounded half up, for non-negative integers. */
export function mulDivRound(a: bigint, b: bigint, c: bigint): bigint {
  if (c <= 0n) throw new Error("Division by zero");
  return (a * b + c / 2n) / c;
}
