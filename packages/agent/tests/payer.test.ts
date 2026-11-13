import { join } from "node:path";
import { SolverrApiError } from "solverr-x402";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WalletAsset } from "../src/assets.js";
import type { ChainWallet } from "../src/chains/chain-wallet.js";
import type { SolverrChallenge } from "../src/challenge.js";
import { PaymentError } from "../src/errors.js";
import type { GatewayClient, GatewayQuote, GatewayStatus } from "../src/gateway.js";
import type { SpendingLimits } from "../src/limits.js";
import { Payer } from "../src/payer.js";
import { SpendLog } from "../src/spend-log.js";
import { GATEWAY, INVOICE_ID, USDC_BASE, USDT_NEAR, fakeWallet, paymentRequired, quoteFor, solverrExtra, tempDir, token } from "./fixtures.js";

/** Status polls and lock retries wait on `sleep`, which returns at once here; a test can make it move a fake clock instead. */
const sleep = vi.hoisted(() => vi.fn(async (_ms: number) => undefined));
vi.mock("../src/timeout.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../src/timeout.js")>()), sleep }));

const RESOURCE = new URL("https://api.example.com/data");
const BASE_ADDRESS = "0xA11CE00000000000000000000000000000000001";

let dir: string;
let cleanup: () => Promise<void>;
let logPath: string;

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  logPath = join(dir, "spend-log.json");
});

afterEach(async () => {
  vi.useRealTimers();
  sleep.mockReset().mockResolvedValue(undefined);
  await cleanup();
});

function challengeFor(overrides: Parameters<typeof solverrExtra>[0] = {}): SolverrChallenge {
  const extra = solverrExtra(overrides);
  const paymentRequiredValue = paymentRequired(extra);
  return { paymentRequired: paymentRequiredValue, requirement: paymentRequiredValue.accepts[0], extra, tokensUrl: `${GATEWAY}/api/v1/tokens` };
}

/** A gateway that never touches a network: USDC on Base at $1, one quote per coin, and a status that is `paid` at once. */
function fakeGateway(wallet: ChainWallet) {
  return {
    listTokens: vi.fn(async (_url: string) => [token(USDC_BASE, 1), token(USDT_NEAR, 1)]),
    requestQuote: vi.fn(async (_url: string, originAsset: string, _refund: string): Promise<GatewayQuote> => {
      const asset = [USDC_BASE, USDT_NEAR].find((item) => item.asset_id === originAsset) as WalletAsset;
      return quoteFor(asset, wallet.address);
    }),
    reportDeposit: vi.fn(async (): Promise<GatewayStatus> => ({ status: "processing", payment: null })),
    getStatus: vi.fn(async (): Promise<GatewayStatus> => ({ status: "paid", payment: null })),
  };
}

function setup(limits: Partial<SpendingLimits> = {}, log = new SpendLog(logPath)) {
  const wallet = fakeWallet("base", BASE_ADDRESS, { [USDC_BASE.asset_id]: 100_000_000n });
  const gateway = fakeGateway(wallet);
  const current: SpendingLimits = { perPaymentUsd: 5, dailyUsd: 20, allow: ["api.example.com"], ...limits };
  const payer = new Payer({ wallets: [wallet], assets: [USDC_BASE], spendLog: log, gateway: gateway as unknown as GatewayClient, limits: () => current, paymentTimeoutMs: 60_000 });
  return { payer, wallet, gateway, log };
}

async function failure(promise: Promise<unknown>): Promise<PaymentError> {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(PaymentError);
  return error as PaymentError;
}

describe("Payer", () => {
  it("pays the quoted exact amount to the deposit address and records the payment as paid", async () => {
    const { payer, wallet, gateway, log } = setup();
    await payer.pay(RESOURCE, challengeFor());
    expect(gateway.requestQuote).toHaveBeenCalledWith(solverrExtra().quote_url, USDC_BASE.asset_id, BASE_ADDRESS);
    expect(wallet.transfer).toHaveBeenCalledWith(USDC_BASE, "0x1111111111111111111111111111111111111111", 4_100_000n);
    expect(gateway.reportDeposit).toHaveBeenCalledWith(solverrExtra().deposit_url, "0xtxhash", "quote_1");
    const [entry] = await log.entries();
    expect(entry).toMatchObject({ invoice_id: INVOICE_ID, host: "api.example.com", status: "paid", amount_usd: 4.1, tx_hash: "0xtxhash", amount_base: "4100000", asset_id: USDC_BASE.asset_id });
  });

  it("refuses a host off the allow list before asking the gateway anything", async () => {
    const { payer, gateway } = setup({ allow: ["other.example.com"] });
    expect((await failure(payer.pay(RESOURCE, challengeFor()))).code).toBe("host_not_allowed");
    expect(gateway.listTokens).not.toHaveBeenCalled();
  });

  it("refuses a test invoice", async () => {
    const { payer, gateway } = setup();
    expect((await failure(payer.pay(RESOURCE, challengeFor({ mode: "test" })))).code).toBe("test_invoice");
    expect(gateway.listTokens).not.toHaveBeenCalled();
  });

  it("refuses an invoice that expires within a minute", async () => {
    const { payer } = setup();
    expect((await failure(payer.pay(RESOURCE, challengeFor({ expires_at: new Date(Date.now() + 30_000).toISOString() })))).code).toBe("invoice_expired");
  });

  it("refuses a payment above the per-payment limit without reserving it", async () => {
    const { payer, gateway, log } = setup({ perPaymentUsd: 3 });
    const error = await failure(payer.pay(RESOURCE, challengeFor()));
    expect(error).toMatchObject({ code: "per_payment_limit", fundsSent: false });
    expect(gateway.requestQuote).not.toHaveBeenCalled();
    expect(await log.entries()).toEqual([]);
  });

  it("prices a USD invoice at the higher of its price and its settlement value", async () => {
    const { payer } = setup({ perPaymentUsd: 4.5 });
    const error = await failure(payer.pay(RESOURCE, challengeFor({ price: "4.6" })));
    expect(error.code).toBe("per_payment_limit");
  });

  it("refuses the second payment that would pass the daily limit", async () => {
    const { payer, wallet } = setup({ dailyUsd: 6 });
    await payer.pay(RESOURCE, challengeFor());
    expect((await failure(payer.pay(RESOURCE, challengeFor()))).code).toBe("daily_limit");
    expect(wallet.transfer).toHaveBeenCalledTimes(1);
  });

  it("runs concurrent payments one at a time so only one passes the daily limit", async () => {
    const { payer, wallet, log } = setup({ dailyUsd: 6 });
    const results = await Promise.allSettled([payer.pay(RESOURCE, challengeFor()), payer.pay(RESOURCE, challengeFor())]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "daily_limit" } });
    expect(wallet.transfer).toHaveBeenCalledTimes(1);
    expect((await log.entries()).map((entry) => entry.status)).toEqual(["paid"]);
  });

  it("lets only one of two agents sharing a spend log pass the daily limit", async () => {
    const first = setup({ dailyUsd: 6 }, new SpendLog(logPath));
    const second = setup({ dailyUsd: 6 }, new SpendLog(logPath));
    const results = await Promise.allSettled([first.payer.pay(RESOURCE, challengeFor()), second.payer.pay(RESOURCE, challengeFor())]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(first.wallet.transfer.mock.calls.length + second.wallet.transfer.mock.calls.length).toBe(1);
  });

  it("checks the quoted amount against the limits again and aborts without sending", async () => {
    const { payer, wallet, log } = setup({ perPaymentUsd: 4.05 });
    const error = await failure(payer.pay(RESOURCE, challengeFor()));
    expect(error).toMatchObject({ code: "per_payment_limit", fundsSent: false });
    expect(wallet.transfer).not.toHaveBeenCalled();
    expect(await log.entries()).toEqual([expect.objectContaining({ status: "aborted", amount_usd: 4, error: expect.stringContaining("$4.10") })]);
    await expect(log.spentLast24hUsd()).resolves.toBe(0);
  });

  it.each([
    ["a TEST- deposit address", { deposit_address: "TEST-deposit" }, "test_invoice"],
    ["another coin", { coin: { asset_id: USDT_NEAR.asset_id, symbol: "USDT", blockchain: "near", decimals: 6 } }, "quote_mismatch"],
    ["another refund address", { refund_address: "0xB0B0000000000000000000000000000000000002" }, "quote_mismatch"],
    ["an invalid deposit address", { deposit_address: "not valid" }, "quote_mismatch"],
    ["a memo", { deposit_memo: "123" }, "quote_mismatch"],
    ["a malformed amount", { amount_in_base: "4.1" }, "quote_mismatch"],
    ["a zero amount", { amount_in_base: "0" }, "quote_mismatch"],
    ["more than the balance", { amount_in_base: "100000001" }, "no_funds"],
    ["a deadline within a minute", { deadline: new Date(Date.now() + 30_000).toISOString() }, "quote_mismatch"],
    ["a price far above the estimate", { amount_in_base: "4500000" }, "quote_mismatch"],
  ])("refuses a quote with %s and sends nothing", async (_name, overrides, code) => {
    const { payer, wallet, gateway, log } = setup();
    gateway.requestQuote.mockResolvedValueOnce(quoteFor(USDC_BASE, BASE_ADDRESS, overrides as Partial<GatewayQuote>));
    expect(await failure(payer.pay(RESOURCE, challengeFor()))).toMatchObject({ code, fundsSent: false });
    expect(wallet.transfer).not.toHaveBeenCalled();
    expect((await log.entries())[0].status).toBe("aborted");
  });

  it("accepts a refund address that differs only in letter case", async () => {
    const { payer, wallet, gateway } = setup();
    gateway.requestQuote.mockResolvedValueOnce(quoteFor(USDC_BASE, BASE_ADDRESS.toLowerCase()));
    await payer.pay(RESOURCE, challengeFor());
    expect(wallet.transfer).toHaveBeenCalledTimes(1);
  });

  it("tries the next coin when the gateway refuses a route with 422", async () => {
    const { gateway, log } = setup();
    const near = fakeWallet("near", "agent.near", { [USDT_NEAR.asset_id]: 100_000_000n });
    const wallet = fakeWallet("base", BASE_ADDRESS, { [USDC_BASE.asset_id]: 100_000_000n });
    const twoCoins = new Payer({
      wallets: [wallet, near],
      assets: [USDC_BASE, USDT_NEAR],
      spendLog: log,
      gateway: gateway as unknown as GatewayClient,
      limits: () => ({ perPaymentUsd: 5, dailyUsd: 20, allow: ["api.example.com"] }),
      paymentTimeoutMs: 60_000,
    });
    gateway.requestQuote.mockRejectedValueOnce(new SolverrApiError("Route minimum is $10", 422, "invalid_request_error"));
    gateway.requestQuote.mockResolvedValueOnce(quoteFor(USDT_NEAR, "agent.near", { deposit_address: "deposit.near" }));
    await twoCoins.pay(RESOURCE, challengeFor());
    expect(gateway.requestQuote.mock.calls.map((call) => call[1])).toEqual([USDC_BASE.asset_id, USDT_NEAR.asset_id]);
    expect(near.transfer).toHaveBeenCalledWith(USDT_NEAR, "deposit.near", 4_100_000n);
    expect(wallet.transfer).not.toHaveBeenCalled();
  });

  it("reports no_funds when no coin covers the amount", async () => {
    const { payer, wallet } = setup();
    wallet.balance.mockResolvedValue(1n);
    expect(await failure(payer.pay(RESOURCE, challengeFor()))).toMatchObject({ code: "no_funds", fundsSent: false });
  });

  it("stops before the transfer when the signal is aborted, and sends nothing", async () => {
    const { payer, wallet, gateway, log } = setup();
    const controller = new AbortController();
    gateway.requestQuote.mockImplementationOnce(async () => {
      controller.abort(new Error("caller gave up"));
      return quoteFor(USDC_BASE, BASE_ADDRESS);
    });
    await expect(payer.pay(RESOURCE, challengeFor(), controller.signal)).rejects.toThrow("caller gave up");
    expect(wallet.transfer).not.toHaveBeenCalled();
    expect((await log.entries())[0].status).toBe("aborted");
  });

  it("finishes the payment when the signal is aborted after the transfer started", async () => {
    const { payer, wallet, log } = setup();
    const controller = new AbortController();
    wallet.transfer.mockImplementationOnce(async () => {
      controller.abort();
      return { hash: "0xtxhash" };
    });
    await payer.pay(RESOURCE, challengeFor(), controller.signal);
    expect((await log.entries())[0].status).toBe("paid");
  });

  it("reports funds sent with the invoice ID when the invoice fails after the transfer", async () => {
    const { payer, gateway, log } = setup();
    gateway.getStatus.mockResolvedValueOnce({ status: "refunded", payment: null });
    expect(await failure(payer.pay(RESOURCE, challengeFor()))).toMatchObject({ code: "payment_failed", fundsSent: true, invoiceId: INVOICE_ID });
    expect((await log.entries())[0]).toMatchObject({ status: "failed", error: "Invoice refunded" });
    await expect(log.spentLast24hUsd()).resolves.toBe(4.1);
  });

  it("keeps polling an expired invoice until a late deposit makes it paid", async () => {
    const { payer, gateway, log } = setup();
    gateway.getStatus.mockResolvedValueOnce({ status: "expired", payment: null }).mockResolvedValueOnce({ status: "detected", payment: null });
    await payer.pay(RESOURCE, challengeFor());
    expect(gateway.getStatus).toHaveBeenCalledTimes(3);
    expect((await log.entries())[0].status).toBe("paid");
  });

  it("times out with funds sent when the invoice stays expired until the payment timeout", async () => {
    const { payer, gateway, log } = setup();
    vi.useFakeTimers({ toFake: ["Date"] });
    sleep.mockImplementation(async (ms: number) => void vi.setSystemTime(Date.now() + ms));
    gateway.getStatus.mockResolvedValue({ status: "expired", payment: null });
    const error = await failure(payer.pay(RESOURCE, challengeFor()));
    expect(error).toMatchObject({ code: "payment_timeout", fundsSent: true, invoiceId: INVOICE_ID });
    expect(error.message).toContain('still "expired" after 60 s');
    expect(gateway.getStatus).toHaveBeenCalledTimes(20);
    expect((await log.entries())[0].status).toBe("sent");
  });

  it("turns any error after the transfer into payment_unconfirmed with funds sent", async () => {
    const { payer, gateway } = setup();
    gateway.getStatus.mockRejectedValueOnce(new TypeError("socket hang up"));
    expect(await failure(payer.pay(RESOURCE, challengeFor()))).toMatchObject({ code: "payment_unconfirmed", fundsSent: true, invoiceId: INVOICE_ID });
  });

  it("keeps paying when reporting the deposit fails", async () => {
    const { payer, gateway, log } = setup();
    gateway.reportDeposit.mockRejectedValueOnce(new Error("gateway down"));
    await payer.pay(RESOURCE, challengeFor());
    expect((await log.entries())[0].status).toBe("paid");
  });

  it("keeps the next queued payment running after one fails", async () => {
    const { payer, wallet } = setup();
    const results = await Promise.allSettled([payer.pay(RESOURCE, challengeFor({ mode: "test" })), payer.pay(RESOURCE, challengeFor())]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled"]);
    expect(wallet.transfer).toHaveBeenCalledTimes(1);
  });
});
