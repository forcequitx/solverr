import { describe, expect, it } from "vitest";
import { OneClickError } from "@/lib/oneclick/client";
import { routeMinimumUsd } from "@/lib/oneclick/route-minimum";
import type { OneClickToken } from "@/lib/oneclick/types";

function token(overrides: Partial<OneClickToken>): OneClickToken {
  return { assetId: "nep141:test.near", decimals: 6, blockchain: "base", symbol: "USDC", price: 1, priceUpdatedAt: "2026-11-10T00:00:00Z", ...overrides };
}

const USDC_BASE = token({ assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near" });
const USDT_TRON = token({ assetId: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", blockchain: "tron", symbol: "USDT", price: 0.9987 });
const ETH = token({ assetId: "nep141:eth.omft.near", blockchain: "eth", symbol: "ETH", decimals: 18, price: 3012.45 });
const WNEAR = token({ assetId: "nep141:wrap.near", blockchain: "near", symbol: "wNEAR", decimals: 24, price: 2.37 });
const BTC = token({ assetId: "nep141:btc.omft.near", blockchain: "btc", symbol: "BTC", decimals: 8, price: 97_123.45 });

/** A 1Click 400 refusal whose JSON body carries `message`, as `request` in lib/oneclick/client.ts builds it. */
const refusal = (message: string) => new OneClickError("1Click POST /v0/quote failed with 400", 400, { message });

describe("routeMinimumUsd", () => {
  it("reads a dollar minimum, with or without the dollar sign and thousands separators", () => {
    expect(routeMinimumUsd(refusal("Amount is too low. The minimum swap amount is $1,000"), USDC_BASE, ETH)).toBe(1000);
    expect(routeMinimumUsd(refusal("minimum swap amount is $12.5"), USDC_BASE, ETH)).toBe(12.5);
    expect(routeMinimumUsd(refusal("Minimum swap amount is 250"), USDC_BASE, ETH)).toBe(250);
  });

  it("converts a bridge minimum from the destination coin's base units", () => {
    expect(routeMinimumUsd(refusal("Amount is too low for bridge, try at least 1310000"), WNEAR, USDC_BASE)).toBe(1.31);
    expect(routeMinimumUsd(refusal("Amount is too low for bridge, try at least 500000000000000"), USDC_BASE, ETH)).toBe(1.51);
  });

  it("returns null for a bridge minimum when the destination coin is unknown", () => {
    expect(routeMinimumUsd(refusal("Amount is too low for bridge, try at least 1310000"), USDC_BASE, undefined)).toBeNull();
  });

  it("converts an amount-in minimum from the origin coin's base units", () => {
    expect(routeMinimumUsd(refusal("Amount in is too low, minimum is 1000000000000000000000000"), WNEAR, USDC_BASE)).toBe(2.37);
    expect(routeMinimumUsd(refusal("Amount in is too low, minimum is 1500"), BTC, USDC_BASE)).toBe(1.46);
    expect(routeMinimumUsd(refusal("Amount in is too low, minimum is 5000000"), USDC_BASE, ETH)).toBe(5);
  });

  it("counts a dollar stablecoin as $1 whatever its listed price", () => {
    expect(routeMinimumUsd(refusal("Amount in is too low, minimum is 2500000"), USDT_TRON, USDC_BASE)).toBe(2.5);
  });

  it("rounds up to the next cent, never down", () => {
    expect(routeMinimumUsd(refusal("Amount in is too low, minimum is 1000001"), USDC_BASE, ETH)).toBe(1.01);
    expect(routeMinimumUsd(refusal("Amount in is too low, minimum is 12345678"), USDC_BASE, ETH)).toBe(12.35);
    expect(routeMinimumUsd(refusal("minimum swap amount is $4.835"), USDC_BASE, ETH)).toBe(4.84);
  });

  it("keeps an exact cent minimum exact, with no floating-point extra cent", () => {
    expect(routeMinimumUsd(refusal("Amount is too low for bridge, try at least 1100000"), WNEAR, USDC_BASE)).toBe(1.1);
    expect(routeMinimumUsd(refusal("Amount in is too low, minimum is 1100000"), USDC_BASE, ETH)).toBe(1.1);
    expect(routeMinimumUsd(refusal("minimum swap amount is $1.10"), USDC_BASE, ETH)).toBe(1.1);
    expect(routeMinimumUsd(refusal("minimum swap amount is $0.07"), USDC_BASE, ETH)).toBe(0.07);
    expect(routeMinimumUsd(refusal("Amount in is too low, minimum is 4570000"), USDC_BASE, ETH)).toBe(4.57);
  });

  it("matches the wordings in any letter case", () => {
    expect(routeMinimumUsd(refusal("AMOUNT IN IS TOO LOW, MINIMUM IS 5000000"), USDC_BASE, ETH)).toBe(5);
    expect(routeMinimumUsd(refusal("amount is too low for bridge, TRY AT LEAST 1310000"), ETH, USDC_BASE)).toBe(1.31);
  });

  it("prefers the dollar wording when a message holds more than one", () => {
    expect(routeMinimumUsd(refusal("minimum swap amount is $100; Amount in is too low, minimum is 5000000"), USDC_BASE, ETH)).toBe(100);
  });

  it("reads the error's own message when the body has none", () => {
    expect(routeMinimumUsd(new OneClickError("Amount in is too low, minimum is 2000000", 400), USDC_BASE, ETH)).toBe(2);
    expect(routeMinimumUsd(new OneClickError("Amount in is too low, minimum is 2000000", 400, { message: 42 }), USDC_BASE, ETH)).toBe(2);
  });

  it("returns null for refusals that name no minimum", () => {
    expect(routeMinimumUsd(refusal("Failed to get quote"), USDC_BASE, ETH)).toBeNull();
    expect(routeMinimumUsd(refusal("No liquidity for this route"), USDC_BASE, ETH)).toBeNull();
    expect(routeMinimumUsd(new OneClickError("1Click POST /v0/quote failed with 400", 400), USDC_BASE, ETH)).toBeNull();
  });

  it("returns null for a zero or unreadable amount", () => {
    expect(routeMinimumUsd(refusal("minimum swap amount is $0"), USDC_BASE, ETH)).toBeNull();
    expect(routeMinimumUsd(refusal("minimum swap amount is $1.2.3"), USDC_BASE, ETH)).toBeNull();
    expect(routeMinimumUsd(refusal("Amount in is too low, minimum is 0"), USDC_BASE, ETH)).toBeNull();
  });
});
