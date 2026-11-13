import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OneClickStatus } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import type { QuoteRequest, QuoteResponse, StatusResponse } from "@/lib/oneclick/types";
import { prepareTransfer } from "@/lib/transfers/execute";
import { createMerchant, createTransfer, ETH, PAYOUT_ADDRESS, USDC_BASE } from "./factories";
import { oneClickStatus } from "./settle";

/** The 1Click quote, status and token list stand in for the network; a gate can hold callers so concurrent requests overlap. */
const oneClick = vi.hoisted(() => ({
  requestQuote: vi.fn<(request: QuoteRequest) => Promise<QuoteResponse>>(),
  fetchStatus: vi.fn<(depositAddress: string, depositMemo?: string | null) => Promise<StatusResponse>>(),
  tokenGate: null as (() => Promise<void>) | null,
}));

const VAULT_BASE = vi.hoisted(() => "nep141:base-0x0bb69b79bc829e1cfcc34a740110886d98d2bd14.omft.near");

vi.mock("@/lib/oneclick/tokens", async (importOriginal) => {
  const { TEST_TOKENS } = await import("./factories");
  const tokens = [...TEST_TOKENS, { assetId: VAULT_BASE, decimals: 18, blockchain: "base", symbol: "gtUSDCp", price: 1, priceUpdatedAt: "", contractAddress: "0x0bb69b79bc829e1cfcc34a740110886d98d2bd14" }];
  return {
    ...(await importOriginal<typeof import("@/lib/oneclick/tokens")>()),
    findToken: async (assetId: string) => {
      await oneClick.tokenGate?.();
      return tokens.find((token) => token.assetId === assetId);
    },
  };
});

vi.mock("@/lib/oneclick/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/oneclick/client")>()),
  requestQuote: oneClick.requestQuote,
  fetchStatus: oneClick.fetchStatus,
}));

const RECIPIENT = "0x4444444444444444444444444444444444444444";
const ETH_RECIPIENT = "0x5555555555555555555555555555555555555555";
const OLD_DEPOSIT = "0x6666666666666666666666666666666666666666";
const USDC_CONTRACT = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

/** A 1Click quote for `request` with a fresh deposit address, as a real quote would get. */
function quoteFor(request: QuoteRequest): QuoteResponse {
  return {
    correlationId: `corr-${randomBytes(4).toString("hex")}`,
    timestamp: new Date().toISOString(),
    signature: "ed25519:test",
    quoteRequest: request,
    quote: {
      depositAddress: `0x${randomBytes(20).toString("hex")}`,
      amountIn: request.amount,
      amountInFormatted: "10",
      amountInUsd: "10",
      minAmountIn: request.amount,
      amountOut: "3333333333333333",
      amountOutFormatted: "0.003333",
      amountOutUsd: "9.99",
      minAmountOut: "3300000000000000",
      timeEstimate: 30,
    },
  };
}

/** Holds each caller until `count` have arrived, so concurrent requests all read the transfer before any of them writes it. */
function meeting(count: number): () => Promise<void> {
  let arrived = 0;
  let open!: () => void;
  const allHere = new Promise<void>((resolve) => (open = resolve));
  return () => {
    if (++arrived === count) open();
    return allHere;
  };
}

const reload = (id: string) => getDb().transfer.findUniqueOrThrow({ where: { id } });
const statusAnswer = (status: OneClickStatus) => oneClickStatus({ correlationId: "corr-old", amountIn: "10000000" }, status);

/** A USDC → ETH payout already prepared once: its old deposit address may have been paid. */
async function preparedSwap() {
  const merchant = await createMerchant();
  const transfer = await createTransfer(merchant, {
    destinationAsset: ETH,
    recipient: ETH_RECIPIENT,
    depositAddress: OLD_DEPOSIT,
    depositMemo: "memo-old",
    amountInBase: "10000000",
    correlationId: "corr-old",
    txSender: PAYOUT_ADDRESS,
  });
  return { merchant, transfer };
}

beforeEach(() => {
  oneClick.requestQuote.mockImplementation(async (request) => quoteFor(request));
});

afterEach(() => {
  oneClick.tokenGate = null;
});

describe("prepareTransfer", () => {
  it("prepares a same-coin payout straight to its recipient, from the payout wallet", async () => {
    const merchant = await createMerchant();
    const transfer = await createTransfer(merchant);
    expect(await prepareTransfer(transfer.id, merchant.id, false)).toEqual({
      instruction: { evmChainId: 8453, tokenContract: USDC_CONTRACT, decimals: 6, amountBase: "10000000", depositAddress: RECIPIENT },
    });
    expect(await reload(transfer.id)).toMatchObject({ status: "pending", recipient: RECIPIENT, depositAddress: RECIPIENT, amountInBase: "10000000", txSender: PAYOUT_ADDRESS, correlationId: null });
    expect(oneClick.requestQuote).not.toHaveBeenCalled();
  });

  it("prepares a swap through a 1Click quote that the worker then follows", async () => {
    const merchant = await createMerchant();
    const transfer = await createTransfer(merchant, { destinationAsset: ETH, recipient: ETH_RECIPIENT });
    const prepared = await prepareTransfer(transfer.id, merchant.id, false);

    expect(oneClick.requestQuote).toHaveBeenCalledOnce();
    const [request] = oneClick.requestQuote.mock.calls[0];
    expect(request).toMatchObject({ dry: false, swapType: "EXACT_INPUT", originAsset: USDC_BASE, destinationAsset: ETH, amount: "10000000", recipient: ETH_RECIPIENT, refundTo: PAYOUT_ADDRESS });
    const quote = await oneClick.requestQuote.mock.results[0].value;
    expect(prepared).toEqual({ instruction: { evmChainId: 8453, tokenContract: USDC_CONTRACT, decimals: 6, amountBase: "10000000", depositAddress: quote.quote.depositAddress } });
    const after = await reload(transfer.id);
    expect(after).toMatchObject({ depositAddress: quote.quote.depositAddress, correlationId: quote.correlationId, txSender: PAYOUT_ADDRESS, oneclickStatus: null });
    expect(after.nextPollAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns preparedBefore for a prepared transfer without sendAgain, and changes nothing", async () => {
    const merchant = await createMerchant();
    const direct = await createTransfer(merchant);
    await prepareTransfer(direct.id, merchant.id, false);
    const directBefore = await reload(direct.id);
    const swap = await preparedSwap();

    expect(await prepareTransfer(direct.id, merchant.id, false)).toEqual({ preparedBefore: true });
    expect(await prepareTransfer(swap.transfer.id, swap.merchant.id, false)).toEqual({ preparedBefore: true });
    expect(await reload(direct.id)).toEqual(directBefore);
    expect(await reload(swap.transfer.id)).toEqual(swap.transfer);
    expect(oneClick.fetchStatus).not.toHaveBeenCalled();
    expect(oneClick.requestQuote).not.toHaveBeenCalled();
  });

  it("refuses a transfer that is no longer pending", async () => {
    const merchant = await createMerchant();
    const transfer = await createTransfer(merchant, { status: "processing", depositAddress: RECIPIENT });
    await expect(prepareTransfer(transfer.id, merchant.id, true)).rejects.toMatchObject({ status: 409, message: "This transfer was already sent." });
  });

  it.each<OneClickStatus>(["PENDING_DEPOSIT", "REFUNDED", "FAILED"])("sends a swap again when 1Click shows its old address %s", async (status) => {
    const { merchant, transfer } = await preparedSwap();
    oneClick.fetchStatus.mockResolvedValue(statusAnswer(status));
    const prepared = await prepareTransfer(transfer.id, merchant.id, true);

    expect(oneClick.fetchStatus).toHaveBeenCalledWith(OLD_DEPOSIT, "memo-old");
    const quote = await oneClick.requestQuote.mock.results[0].value;
    expect(prepared).toMatchObject({ instruction: { depositAddress: quote.quote.depositAddress } });
    expect(await reload(transfer.id)).toMatchObject({ depositAddress: quote.quote.depositAddress, depositMemo: null, correlationId: quote.correlationId });
  });

  it.each<OneClickStatus>(["KNOWN_DEPOSIT_TX", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS"])(
    "refuses to send a swap again once its old address shows %s",
    async (status) => {
      const { merchant, transfer } = await preparedSwap();
      oneClick.fetchStatus.mockResolvedValue(statusAnswer(status));
      await expect(prepareTransfer(transfer.id, merchant.id, true)).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining("already sent this transfer to the payment network"),
      });
      expect(oneClick.requestQuote).not.toHaveBeenCalled();
      expect(await reload(transfer.id)).toEqual(transfer);
    },
  );

  it("prepares a same-coin transfer again with sendAgain without asking 1Click", async () => {
    const merchant = await createMerchant();
    const transfer = await createTransfer(merchant, { depositAddress: RECIPIENT, amountInBase: "10000000", txSender: PAYOUT_ADDRESS });
    expect(await prepareTransfer(transfer.id, merchant.id, true)).toMatchObject({ instruction: { depositAddress: RECIPIENT } });
    expect(oneClick.fetchStatus).not.toHaveBeenCalled();
  });

  it("refuses a transfer created for an earlier payout network", async () => {
    const merchant = await createMerchant({ payoutChain: "near", payoutAddress: "northwind.near" });
    const transfer = await createTransfer(merchant, { destinationAsset: ETH, recipient: ETH_RECIPIENT });
    await expect(prepareTransfer(transfer.id, merchant.id, false)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("earlier payout network") });
    expect(oneClick.requestQuote).not.toHaveBeenCalled();
    expect(await reload(transfer.id)).toEqual(transfer);
  });

  it.each([
    { path: "an Earn vault swap", sourceAsset: VAULT_BASE },
    { path: "a same-coin transfer", sourceAsset: USDC_BASE },
  ])("sends a withdrawal to the payout wallet the business has now ($path)", async ({ sourceAsset }) => {
    const currentWallet = "0x7777777777777777777777777777777777777777";
    const merchant = await createMerchant({ payoutAddress: currentWallet });
    const transfer = await createTransfer(merchant, { kind: "withdrawal", sourceAsset, destinationAsset: USDC_BASE, recipient: PAYOUT_ADDRESS });
    const prepared = await prepareTransfer(transfer.id, merchant.id, false);

    expect((await reload(transfer.id)).recipient).toBe(currentWallet);
    if (sourceAsset === USDC_BASE) {
      expect(prepared).toMatchObject({ instruction: { depositAddress: currentWallet } });
    } else {
      expect(oneClick.requestQuote).toHaveBeenCalledWith(expect.objectContaining({ recipient: currentWallet, refundTo: currentWallet }));
    }
  });

  it("keeps a payout's own recipient when the payout wallet changed", async () => {
    const merchant = await createMerchant({ payoutAddress: "0x7777777777777777777777777777777777777777" });
    const transfer = await createTransfer(merchant);
    expect(await prepareTransfer(transfer.id, merchant.id, false)).toMatchObject({ instruction: { depositAddress: RECIPIENT } });
  });

  it("lets only one of two concurrent preparations of a swap keep its deposit address", async () => {
    const merchant = await createMerchant();
    const transfer = await createTransfer(merchant, { destinationAsset: ETH, recipient: ETH_RECIPIENT });
    const bothQuoting = meeting(2);
    oneClick.requestQuote.mockImplementation(async (request) => {
      await bothQuoting();
      return quoteFor(request);
    });

    const results = await Promise.all([prepareTransfer(transfer.id, merchant.id, false), prepareTransfer(transfer.id, merchant.id, false)]);
    expect(oneClick.requestQuote).toHaveBeenCalledTimes(2);
    const kept = results.filter((result) => "instruction" in result);
    expect(kept).toHaveLength(1);
    expect(results).toContainEqual({ preparedBefore: true });
    expect((await reload(transfer.id)).depositAddress).toBe(kept[0].instruction.depositAddress);
  });

  it("lets only one of two concurrent preparations of a same-coin transfer through", async () => {
    const merchant = await createMerchant();
    const transfer = await createTransfer(merchant);
    oneClick.tokenGate = meeting(2);
    const results = await Promise.all([prepareTransfer(transfer.id, merchant.id, false), prepareTransfer(transfer.id, merchant.id, false)]);
    expect(results.filter((result) => "instruction" in result)).toHaveLength(1);
    expect(results).toContainEqual({ preparedBefore: true });
  });

  it("lets only one of two concurrent sendAgain requests replace the old deposit address", async () => {
    const { merchant, transfer } = await preparedSwap();
    oneClick.fetchStatus.mockResolvedValue(statusAnswer("PENDING_DEPOSIT"));
    const bothQuoting = meeting(2);
    oneClick.requestQuote.mockImplementation(async (request) => {
      await bothQuoting();
      return quoteFor(request);
    });

    const results = await Promise.all([prepareTransfer(transfer.id, merchant.id, true), prepareTransfer(transfer.id, merchant.id, true)]);
    const kept = results.filter((result) => "instruction" in result);
    expect(kept).toHaveLength(1);
    expect(results).toContainEqual({ preparedBefore: true });
    expect((await reload(transfer.id)).depositAddress).toBe(kept[0].instruction.depositAddress);
  });

  it("refuses with 409 when the payout wallet changed while the quote was made, so no transfer is bound to the replaced wallet", async () => {
    const merchant = await createMerchant();
    const transfer = await createTransfer(merchant, { destinationAsset: ETH, recipient: ETH_RECIPIENT });
    oneClick.requestQuote.mockImplementation(async (request) => {
      /** The owner saves another payout wallet meanwhile. */
      await getDb().merchant.update({ where: { id: merchant.id }, data: { payoutAddress: RECIPIENT } });
      return quoteFor(request);
    });

    await expect(prepareTransfer(transfer.id, merchant.id, false)).rejects.toMatchObject({ status: 409, message: "Your payout wallet changed meanwhile. Reload the page." });
    expect(await reload(transfer.id)).toMatchObject({ depositAddress: null, correlationId: null, txSender: null });
  });

  it("refuses with 409 when the amount changed while the quote was made", async () => {
    const merchant = await createMerchant();
    const transfer = await createTransfer(merchant, { destinationAsset: ETH, recipient: ETH_RECIPIENT });
    oneClick.requestQuote.mockImplementation(async (request) => {
      /** A refund of the paid invoice resizes the split payout meanwhile. */
      await getDb().transfer.update({ where: { id: transfer.id }, data: { amount: "4" } });
      return quoteFor(request);
    });

    await expect(prepareTransfer(transfer.id, merchant.id, false)).rejects.toMatchObject({ status: 409, message: "This transfer changed meanwhile. Reload the page." });
    expect(await reload(transfer.id)).toMatchObject({ amount: "4", depositAddress: null, correlationId: null });
  });
});
