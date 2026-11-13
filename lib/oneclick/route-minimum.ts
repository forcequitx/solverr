import { oneClickMessage, type OneClickError } from "@/lib/oneclick/client";
import { isUsdStablecoin } from "@/lib/oneclick/tokens";
import type { OneClickToken } from "@/lib/oneclick/types";
import { numberToDecimal, toBaseUnits } from "@/lib/money";

/** Decimal places of a token price in the cent math; `numberToDecimal` keeps the same 12. */
const PRICE_DECIMALS = 12;

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** Whole cents of a dollar amount such as "1,000" or "4.835", rounded up; null when it is not a number. */
function centsOfDollars(text: string): bigint | null {
  const value = text.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const extra = (value.split(".")[1] ?? "").slice(2);
  return toBaseUnits(value, 2) + (/[1-9]/.test(extra) ? 1n : 0n);
}

/** Whole cents, rounded up, of an amount in a token's base units; a dollar stablecoin counts as $1. */
function centsOfUnits(units: string, token: OneClickToken): bigint | null {
  if (!isUsdStablecoin(token) && !(Number.isFinite(token.price) && token.price >= 0)) return null;
  const price = isUsdStablecoin(token) ? 10n ** BigInt(PRICE_DECIMALS) : toBaseUnits(numberToDecimal(token.price), PRICE_DECIMALS);
  return ceilDiv(BigInt(units) * price * 100n, 10n ** BigInt(token.decimals + PRICE_DECIMALS));
}

/** USD minimum (rounded up to a cent, in exact integer math) 1Click names when refusing a route as too small, or null. Wordings: "minimum swap
    amount is $1,000" (dollars), "too low for bridge, try at least N" (destination units), "Amount in is too low, minimum is N" (origin units). */
export function routeMinimumUsd(error: OneClickError, origin: OneClickToken, destination: OneClickToken | undefined): number | null {
  const message = oneClickMessage(error);
  let cents: bigint | null = null;
  const dollars = /minimum swap amount is \$?([\d.,]+)/i.exec(message);
  const bridge = /too low for bridge, try at least (\d+)/i.exec(message);
  const amountIn = /amount in is too low, minimum is (\d+)/i.exec(message);
  if (dollars) cents = centsOfDollars(dollars[1]);
  else if (bridge && destination) cents = centsOfUnits(bridge[1], destination);
  else if (amountIn) cents = centsOfUnits(amountIn[1], origin);
  return cents !== null && cents > 0n ? Number(cents) / 100 : null;
}
