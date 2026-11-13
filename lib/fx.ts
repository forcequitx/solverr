import { createRefreshingCache } from "@/lib/refreshing-cache";
import { DAY_MS, HOUR_MS } from "@/lib/time";

export const SUPPORTED_CURRENCIES = ["USD", "EUR", "INR"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

const FX_URL = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,INR";
const TIMEOUT_MS = 10_000;

type RatesResponse = { base: string; date: string; rates: Record<string, number> };

async function fetchRates(): Promise<Record<string, number>> {
  const response = await fetch(FX_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Currency rates request failed with ${response.status}`);
  const body = (await response.json()) as RatesResponse;
  if (body.base !== "USD") throw new Error(`Unexpected currency rates base: ${body.base}`);
  return body.rates;
}

/** ECB reference rates change once per working day, so the last rates stay usable for a day when a refresh is slow or fails. */
const currentRates = createRefreshingCache({ freshMs: HOUR_MS, staleMs: DAY_MS, load: fetchRates });

/** Units of `currency` per 1 USD (ECB reference rates, cached for one hour). */
export async function unitsPerUsd(currency: Currency): Promise<number> {
  if (currency === "USD") return 1;
  const rate = (await currentRates())[currency];
  if (!rate || rate <= 0) throw new Error(`No currency rate for ${currency}`);
  return rate;
}
