import { describe, expect, it } from "vitest";
import { rankPaymentOptions } from "../src/coin-selection.js";
import { ETH_BASE, USDC_BASE, USDC_NEAR, USDT_NEAR, fakeWallet, token } from "./fixtures.js";

const settlement = { asset_id: USDC_BASE.asset_id, symbol: "usdc" };
const rich = (...assetIds: string[]) => Object.fromEntries(assetIds.map((id) => [id, 10n ** 30n]));

describe("rankPaymentOptions", () => {
  it("ranks the settlement coin, then the same coin elsewhere, then stablecoins, then other coins", async () => {
    const near = fakeWallet("near", "agent.near", rich(USDC_NEAR.asset_id, USDT_NEAR.asset_id));
    const base = fakeWallet("base", "0xagent", rich(USDC_BASE.asset_id, ETH_BASE.asset_id));
    const { options, skipped } = await rankPaymentOptions({
      wallets: [near, base],
      assets: [ETH_BASE, USDT_NEAR, USDC_NEAR],
      tokens: [token(ETH_BASE, 3000), token(USDT_NEAR, 1), token(USDC_NEAR, 1), token(USDC_BASE, 1)],
      settlement,
      amountUsd: 10,
    });
    expect(skipped).toEqual([]);
    expect(options.map((option) => [option.asset.symbol, option.asset.blockchain, option.tier])).toEqual([
      ["USDC", "base", 0],
      ["USDC", "near", 1],
      ["USDT", "near", 2],
      ["ETH", "base", 3],
    ]);
    expect(options[0].wallet).toBe(base);
  });

  it("estimates the amount with a 3% buffer, rounded up in base units", async () => {
    const base = fakeWallet("base", "0xagent", rich(USDC_BASE.asset_id, ETH_BASE.asset_id));
    const { options } = await rankPaymentOptions({ wallets: [base], assets: [USDC_BASE, ETH_BASE], tokens: [token(USDC_BASE, 1), token(ETH_BASE, 2000)], settlement, amountUsd: 10 });
    expect(options.find((option) => option.asset === USDC_BASE)?.estimatedAmount).toBe(10_300_001n);
    expect(options.find((option) => option.asset === ETH_BASE)?.estimatedAmount).toBe(5_150_000_000_000_001n);
  });

  it("adds the settlement coin from the gateway's list when the wallet's chain can hold it", async () => {
    const base = fakeWallet("base", "0xagent", rich(USDC_BASE.asset_id));
    const { options } = await rankPaymentOptions({ wallets: [base], assets: [], tokens: [token(USDC_BASE, 1)], settlement, amountUsd: 1 });
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ tier: 0, asset: { asset_id: USDC_BASE.asset_id, decimals: 6, contract_address: USDC_BASE.contract_address } });
  });

  it("ignores coins on chains without a wallet, the settlement coin included", async () => {
    const near = fakeWallet("near", "agent.near", rich(USDC_NEAR.asset_id));
    const { options, skipped } = await rankPaymentOptions({ wallets: [near], assets: [USDC_NEAR, ETH_BASE], tokens: [token(USDC_NEAR, 1), token(USDC_BASE, 1), token(ETH_BASE, 3000)], settlement, amountUsd: 1 });
    expect(options.map((option) => option.asset.asset_id)).toEqual([USDC_NEAR.asset_id]);
    expect(skipped).toEqual([]);
  });

  it("skips coins without a price, with too low a balance, or whose balance cannot be read", async () => {
    const near = fakeWallet("near", "agent.near", { [USDC_NEAR.asset_id]: 1_000_000n });
    near.balance.mockImplementation(async (asset) => {
      if (asset.asset_id === USDT_NEAR.asset_id) throw new Error("rpc down\nstack");
      return 1_000_000n;
    });
    const { options, skipped } = await rankPaymentOptions({
      wallets: [near],
      assets: [USDC_NEAR, USDT_NEAR, { ...USDC_NEAR, asset_id: "nep141:unpriced.near", symbol: "XYZ" }],
      tokens: [token(USDC_NEAR, 1), token(USDT_NEAR, 1)],
      settlement,
      amountUsd: 5,
    });
    expect(options).toEqual([]);
    expect(skipped.sort()).toEqual(["USDC on near: balance too low", "USDT on near: balance unavailable (rpc down)", "XYZ on near: no price from the gateway"]);
  });

  it("treats a zero or negative price as no price", async () => {
    const near = fakeWallet("near", "agent.near", rich(USDC_NEAR.asset_id));
    const { options, skipped } = await rankPaymentOptions({ wallets: [near], assets: [USDC_NEAR], tokens: [token(USDC_NEAR, 0)], settlement, amountUsd: 1 });
    expect(options).toEqual([]);
    expect(skipped).toEqual(["USDC on near: no price from the gateway"]);
  });

  it("skips a coin whose configured decimals differ from the gateway's, so limits never see a wrong amount", async () => {
    const near = fakeWallet("near", "agent.near", rich(USDC_NEAR.asset_id));
    const misconfigured = { ...USDC_NEAR, decimals: 18 };
    const { options, skipped } = await rankPaymentOptions({ wallets: [near], assets: [misconfigured], tokens: [token(USDC_NEAR, 1)], settlement, amountUsd: 1 });
    expect(options).toEqual([]);
    expect(skipped).toEqual(["USDC on near: set to 18 decimals, but the gateway lists 6"]);
  });

  it("accepts a balance exactly equal to the estimate", async () => {
    const near = fakeWallet("near", "agent.near", { [USDC_NEAR.asset_id]: 1_030_001n });
    const { options } = await rankPaymentOptions({ wallets: [near], assets: [USDC_NEAR], tokens: [token(USDC_NEAR, 1)], settlement, amountUsd: 1 });
    expect(options).toHaveLength(1);
    expect(options[0].balance).toBe(1_030_001n);
  });
});
