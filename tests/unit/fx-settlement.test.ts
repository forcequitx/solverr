import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OneClickToken } from "@/lib/oneclick/types";

/** A Frankfurter-style answer; the rate cache lives in the module, so every test loads a fresh copy of it. */
function ratesResponse(rates: Record<string, number>, base = "USD") {
  return Response.json({ base, date: "2026-11-10", rates });
}

const ratesFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetModules();
  ratesFetch.mockReset();
  vi.stubGlobal("fetch", ratesFetch);
});

const loadFx = () => import("@/lib/fx");
const loadSettlement = () => import("@/lib/invoices/settlement");

/** Compiles the settlement module once, so its cold first import does not count against the first test's timeout. */
beforeAll(async () => {
  await loadSettlement();
});

function token(overrides: Partial<OneClickToken>): OneClickToken {
  return { assetId: "nep141:test.near", decimals: 6, blockchain: "base", symbol: "USDC", price: 1, priceUpdatedAt: "2026-11-10T00:00:00Z", ...overrides };
}

describe("unitsPerUsd", () => {
  it("answers 1 for USD without asking the rate service", async () => {
    const { unitsPerUsd } = await loadFx();
    expect(await unitsPerUsd("USD")).toBe(1);
    expect(ratesFetch).not.toHaveBeenCalled();
  });

  it("reads EUR and INR rates once and serves them from the cache", async () => {
    ratesFetch.mockResolvedValue(ratesResponse({ EUR: 0.92, INR: 83.5 }));
    const { unitsPerUsd } = await loadFx();
    expect(await unitsPerUsd("EUR")).toBe(0.92);
    expect(await unitsPerUsd("INR")).toBe(83.5);
    expect(ratesFetch).toHaveBeenCalledTimes(1);
  });

  it("refuses an answer in another base currency", async () => {
    ratesFetch.mockResolvedValue(ratesResponse({ USD: 1.08 }, "EUR"));
    const { unitsPerUsd } = await loadFx();
    await expect(unitsPerUsd("EUR")).rejects.toThrow("Unexpected currency rates base: EUR");
  });

  it("refuses a failed request and a missing or zero rate", async () => {
    ratesFetch.mockResolvedValueOnce(new Response("busy", { status: 503 }));
    const { unitsPerUsd } = await loadFx();
    await expect(unitsPerUsd("EUR")).rejects.toThrow("failed with 503");

    ratesFetch.mockResolvedValueOnce(ratesResponse({ EUR: 0 }));
    await expect(unitsPerUsd("EUR")).rejects.toThrow("No currency rate for EUR");
  });

  it("keeps serving the last rates for a day when a refresh fails", async () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    try {
      ratesFetch.mockResolvedValueOnce(ratesResponse({ EUR: 0.92, INR: 83.5 }));
      const { unitsPerUsd } = await loadFx();
      expect(await unitsPerUsd("EUR")).toBe(0.92);

      ratesFetch.mockRejectedValue(new Error("rate service down"));
      vi.advanceTimersByTime(2 * 60 * 60_000);
      expect(await unitsPerUsd("EUR")).toBe(0.92);
      /** Lets the failed background refresh settle before the next read. */
      await new Promise((resolve) => setImmediate(resolve));

      vi.advanceTimersByTime(23 * 60 * 60_000);
      await expect(unitsPerUsd("EUR")).rejects.toThrow("rate service down");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("settlementAmountBase", () => {
  it("pays a USD invoice in a dollar stablecoin one to one", async () => {
    const { settlementAmountBase } = await loadSettlement();
    expect(await settlementAmountBase("25.00", "USD", token({ symbol: "USDC", decimals: 6 }))).toBe(25_000_000n);
    expect(await settlementAmountBase("0.01", "USD", token({ symbol: "DAI", decimals: 18 }))).toBe(10n ** 16n);
    expect(ratesFetch).not.toHaveBeenCalled();
  });

  it("converts EUR and INR to USD with the current rate, rounding half up", async () => {
    ratesFetch.mockResolvedValue(ratesResponse({ EUR: 0.92, INR: 83.5 }));
    const { settlementAmountBase } = await loadSettlement();
    /** 25 / 0.92 = 27.1739130434… USD, and 1000 / 83.5 = 11.9760479041… USD. */
    expect(await settlementAmountBase("25.00", "EUR", token({ symbol: "USDT", decimals: 6 }))).toBe(27_173_913n);
    expect(await settlementAmountBase("1000", "INR", token({ symbol: "USDC", decimals: 6 }))).toBe(11_976_048n);
  });

  it("divides by the token's USD price for other coins", async () => {
    const { settlementAmountBase } = await loadSettlement();
    expect(await settlementAmountBase("25", "USD", token({ symbol: "ETH", decimals: 18, price: 2500 }))).toBe(10n ** 16n);
    /** $10 at $3 a coin is 3.333333 with 6 decimals, rounded half up. */
    expect(await settlementAmountBase("10", "USD", token({ symbol: "NEAR", decimals: 6, price: 3 }))).toBe(3_333_333n);
  });

  it("refuses a coin without a current price as an upstream problem", async () => {
    const { settlementAmountBase } = await loadSettlement();
    await expect(settlementAmountBase("25", "USD", token({ symbol: "ETH", decimals: 18, price: 0 }))).rejects.toMatchObject({
      status: 502,
      type: "upstream_unavailable",
    });
  });

  it("turns a rate service failure into a 502 that suggests USD", async () => {
    ratesFetch.mockRejectedValue(new Error("network down"));
    const { settlementAmountBase } = await loadSettlement();
    await expect(settlementAmountBase("25", "EUR", token({}))).rejects.toMatchObject({
      status: 502,
      type: "upstream_unavailable",
      message: expect.stringContaining("use USD"),
    });
  });
});
