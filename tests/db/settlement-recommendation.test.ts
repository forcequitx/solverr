import { describe, expect, it, vi } from "vitest";
import type { RouteStatus } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { recommendedCoin, recommendedNetwork } from "@/lib/merchants/settlement-recommendation";
import type { SettlementOption } from "@/lib/merchants/settlement-options";
import type { OneClickToken } from "@/lib/oneclick/types";
import { freshCoverage } from "@/lib/payments/route-limits";
import { USDC_BASE, USDC_SOLANA } from "./factories";

const USDT_BASE = "nep141:base-0xfde4c96c8593536e31f229ea8f37b2ada2699bb2.omft.near";
const HOUR_MS = 60 * 60_000;

/** Stores `available` working and `refused` refused worker answers into `destination`, checked `ageMs` ago. */
async function answers(destination: string, available: number, refused: number, ageMs = 0, refusedAs: RouteStatus = "unavailable") {
  const checkedAt = new Date(Date.now() - ageMs);
  const rows = Array.from({ length: available + refused }, (_, index) => ({
    originAsset: `nep141:origin-${ageMs}-${index}.near`,
    destinationAsset: destination,
    status: (index < available ? "available" : refusedAs) as RouteStatus,
    minimumUsd: index < available || refusedAs === "unavailable" ? null : "25.00",
    checkedAt,
  }));
  await getDb().routeLimit.createMany({ data: rows });
}

const option = (assetId: string, label: string, earn = false): SettlementOption => ({ assetId, symbol: label.split(" ")[0], label, earn });

const TOKENS: OneClickToken[] = [
  { assetId: USDC_BASE, decimals: 6, blockchain: "base", symbol: "USDC", price: 1, priceUpdatedAt: "", contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  { assetId: USDT_BASE, decimals: 6, blockchain: "base", symbol: "USDT", price: 1, priceUpdatedAt: "", contractAddress: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2" },
  { assetId: USDC_SOLANA, decimals: 6, blockchain: "sol", symbol: "USDC", price: 1, priceUpdatedAt: "", contractAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
];
const tokenList = vi.fn(async () => TOKENS);

describe("freshCoverage", () => {
  it("is the share of fresh answers that work from $1, counting minimums and unavailable routes as answers", async () => {
    await answers(USDC_BASE, 24, 6);
    await answers(USDT_BASE, 10, 15, 0, "minimum");
    expect(await freshCoverage([USDC_BASE, USDT_BASE])).toEqual(new Map([[USDC_BASE, 0.8], [USDT_BASE, 0.4]]));
  });

  it("leaves out a coin with fewer than 20 fresh answers", async () => {
    await answers(USDC_BASE, 19, 0);
    expect(await freshCoverage([USDC_BASE])).toEqual(new Map());
  });

  it("counts only answers from the last 2 hours", async () => {
    await answers(USDC_BASE, 0, 30, 3 * HOUR_MS);
    await answers(USDC_BASE, 20, 0, HOUR_MS);
    expect(await freshCoverage([USDC_BASE])).toEqual(new Map([[USDC_BASE, 1]]));
  });

  it("reads only the coins it is asked about", async () => {
    await answers(USDC_SOLANA, 20, 0);
    expect(await freshCoverage([USDC_BASE])).toEqual(new Map());
    expect(await freshCoverage([])).toEqual(new Map());
  });
});

describe("recommendedCoin", () => {
  const BASE_OPTIONS = [option(USDC_BASE, "USDC on Base"), option(USDT_BASE, "USDT on Base")];

  it("recommends the coin most paying coins reach from $1", async () => {
    await answers(USDC_BASE, 15, 15);
    await answers(USDT_BASE, 27, 3);
    expect(await recommendedCoin(BASE_OPTIONS)).toBe(USDT_BASE);
  });

  it("recommends nothing when only one coin has fresh answers", async () => {
    await answers(USDC_BASE, 27, 3);
    expect(await recommendedCoin(BASE_OPTIONS)).toBeNull();
  });

  it("recommends nothing when two coins tie", async () => {
    await answers(USDC_BASE, 20, 10);
    await answers(USDT_BASE, 20, 10);
    expect(await recommendedCoin(BASE_OPTIONS)).toBeNull();
  });

  it("never recommends an Earn vault share", async () => {
    await answers(USDC_BASE, 15, 15);
    await answers(USDT_BASE, 30, 0);
    expect(await recommendedCoin([option(USDC_BASE, "USDC on Base"), option(USDT_BASE, "Earn: vault", true)])).toBeNull();
  });
});

describe("recommendedNetwork", () => {
  it("recommends the network whose best measured coin leads", async () => {
    await answers(USDC_BASE, 10, 20);
    await answers(USDT_BASE, 21, 9);
    await answers(USDC_SOLANA, 27, 3);
    expect(await recommendedNetwork(["base", "sol", "eth"], tokenList)).toBe("sol");
  });

  it("scores a network by its best coin, not its average", async () => {
    await answers(USDC_BASE, 0, 30);
    await answers(USDT_BASE, 29, 1);
    await answers(USDC_SOLANA, 27, 3);
    expect(await recommendedNetwork(["base", "sol"], tokenList)).toBe("base");
  });

  it("recommends nothing when only one network has fresh answers", async () => {
    await answers(USDC_BASE, 27, 3);
    await answers(USDT_BASE, 12, 18);
    expect(await recommendedNetwork(["base", "sol"], tokenList)).toBeNull();
  });
});
