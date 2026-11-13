/** Currencies the Solverr invoice API accepts. */
export const SUPPORTED_CURRENCIES = ["USD", "EUR", "INR"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

const PRICE_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

/** Price in minor units (cents), used to compare prices without floating point. */
export function priceToCents(price: string): bigint {
  const [whole, fraction = ""] = price.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

/** Throws when `price` is not a positive decimal string with up to 2 decimals or `currency` is unsupported. */
export function assertPrice(price: string, currency: string): asserts currency is Currency {
  if (typeof price !== "string" || !PRICE_PATTERN.test(price) || priceToCents(price) <= 0n) {
    throw new Error(`price must be a positive decimal string with up to 2 decimals, such as "0.05"; got ${JSON.stringify(price)}.`);
  }
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(currency)) {
    throw new Error(`currency must be one of ${SUPPORTED_CURRENCIES.join(", ")}; got ${JSON.stringify(currency)}.`);
  }
}
