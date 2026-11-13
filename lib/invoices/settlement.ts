import { ApiError } from "@/lib/api/errors";
import { type Currency, unitsPerUsd } from "@/lib/fx";
import { mulDivRound, numberToDecimal, toBaseUnits } from "@/lib/money";
import { isUsdStablecoin } from "@/lib/oneclick/tokens";
import type { OneClickToken } from "@/lib/oneclick/types";

const SCALE = 12;
const ONE = 10n ** BigInt(SCALE);

async function usdScaled(amount: string, currency: Currency): Promise<bigint> {
  const scaled = toBaseUnits(amount, SCALE);
  if (currency === "USD") return scaled;
  let rate: number;
  try {
    rate = await unitsPerUsd(currency);
  } catch {
    throw new ApiError(502, "upstream_unavailable", "Currency rates are unavailable right now. Try again shortly or use USD.");
  }
  return mulDivRound(scaled, ONE, toBaseUnits(numberToDecimal(rate), SCALE));
}

/** Amount of `token` (in base units) the merchant receives for an invoice of `amount` `currency`. */
export async function settlementAmountBase(amount: string, currency: Currency, token: OneClickToken): Promise<bigint> {
  const usd = await usdScaled(amount, currency);
  const unit = 10n ** BigInt(token.decimals);
  if (isUsdStablecoin(token)) return mulDivRound(usd, unit, ONE);

  /** 1Click lists some coins without a price; those and prices that round to zero cannot size the invoice. */
  const price = Number.isFinite(token.price) && token.price > 0 ? toBaseUnits(numberToDecimal(token.price), SCALE) : 0n;
  if (price === 0n) {
    throw new ApiError(502, "upstream_unavailable", `No current price for ${token.symbol}. Try again shortly.`);
  }
  return mulDivRound(usd, unit, price);
}
