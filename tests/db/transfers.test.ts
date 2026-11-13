import { describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import type { OneClickToken } from "@/lib/oneclick/types";
import { reportTransferTx } from "@/lib/transfers/execute";
import { createRefund } from "@/lib/transfers/transfers";
import { createInvoice, createMerchant, createQuote, createTransfer, PAYOUT_ADDRESS, USDC_BASE } from "./factories";

const NEAR_TOKEN = "nep141:wrap.near";

/** The 1Click token list and deposit report stand in for the network; nothing leaves the process. */
const oneClick = vi.hoisted(() => ({ submitDeposit: vi.fn(async () => ({})) }));

vi.mock("@/lib/oneclick/tokens", async (importOriginal) => {
  const tokens: OneClickToken[] = [
    { assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", decimals: 6, blockchain: "base", symbol: "USDC", price: 1, priceUpdatedAt: "", contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
    { assetId: "nep141:wrap.near", decimals: 24, blockchain: "near", symbol: "wNEAR", price: 3, priceUpdatedAt: "" },
  ];
  return {
    ...(await importOriginal<typeof import("@/lib/oneclick/tokens")>()),
    findToken: async (assetId: string) => tokens.find((token) => token.assetId === assetId),
  };
});

vi.mock("@/lib/oneclick/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/oneclick/client")>()),
  submitDeposit: oneClick.submitDeposit,
}));

const EVM_HASH = `0x${"AbCd".repeat(16)}`;
const RECIPIENT = "0x4444444444444444444444444444444444444444";

/** A same-coin payout prepared for the wallet to send straight to its recipient. */
async function preparedDirect(overrides: Parameters<typeof createTransfer>[1] = {}) {
  const merchant = await createMerchant();
  const transfer = await createTransfer(merchant, { depositAddress: RECIPIENT, amountInBase: "10000000", txSender: PAYOUT_ADDRESS, ...overrides });
  return { merchant, transfer };
}

const reload = (id: string) => getDb().transfer.findUniqueOrThrow({ where: { id } });

describe("reportTransferTx", () => {
  it("records an EVM hash in lowercase and hands the transfer to the worker", async () => {
    const { merchant, transfer } = await preparedDirect();
    await reportTransferTx(transfer.id, merchant.id, EVM_HASH);
    const after = await reload(transfer.id);
    expect(after).toMatchObject({ status: "processing", txHash: EVM_HASH.toLowerCase(), txSender: PAYOUT_ADDRESS });
    expect(after.txReportedAt).not.toBeNull();
    expect(after.nextPollAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(oneClick.submitDeposit).not.toHaveBeenCalled();
  });

  it("refuses text that is not a transaction hash on the transfer's chain", async () => {
    const { merchant, transfer } = await preparedDirect();
    await expect(reportTransferTx(transfer.id, merchant.id, "0x1234")).rejects.toMatchObject({ status: 400, message: expect.stringContaining("Base") });
  });

  it("refuses a report before the transfer was prepared", async () => {
    const merchant = await createMerchant();
    const transfer = await createTransfer(merchant);
    await expect(reportTransferTx(transfer.id, merchant.id, EVM_HASH)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Prepare the transfer") });
  });

  it("refuses with 409 when the wallet paid an earlier address of the transfer", async () => {
    const { merchant, transfer } = await preparedDirect();
    await expect(reportTransferTx(transfer.id, merchant.id, EVM_HASH, "0x5555555555555555555555555555555555555555")).rejects.toMatchObject({ status: 409 });
    expect((await reload(transfer.id)).status).toBe("pending");
    await reportTransferTx(transfer.id, merchant.id, EVM_HASH, RECIPIENT);
    expect((await reload(transfer.id)).status).toBe("processing");
  });

  it("accepts the same report twice without changing anything, in any letter case", async () => {
    const { merchant, transfer } = await preparedDirect();
    await reportTransferTx(transfer.id, merchant.id, EVM_HASH);
    const first = await reload(transfer.id);
    await reportTransferTx(transfer.id, merchant.id, EVM_HASH.toLowerCase());
    expect(await reload(transfer.id)).toEqual(first);
  });

  it("lets a processing direct transfer take a replacing hash", async () => {
    const { merchant, transfer } = await preparedDirect();
    await reportTransferTx(transfer.id, merchant.id, EVM_HASH);
    const replacement = `0x${"9".repeat(64)}`;
    await reportTransferTx(transfer.id, merchant.id, replacement);
    expect((await reload(transfer.id)).txHash).toBe(replacement);
  });

  it("frees a hash held by a failed or canceled transfer for the real one", async () => {
    const { merchant, transfer } = await preparedDirect();
    const failed = await createTransfer(merchant, { status: "failed", txHash: EVM_HASH.toLowerCase() });
    await reportTransferTx(transfer.id, merchant.id, EVM_HASH);
    expect((await reload(transfer.id)).txHash).toBe(EVM_HASH.toLowerCase());
    expect((await reload(failed.id)).txHash).toBeNull();

    const other = await preparedDirect();
    const canceled = await createTransfer(other.merchant, { status: "canceled", txHash: `0x${"7".repeat(64)}` });
    await reportTransferTx(other.transfer.id, other.merchant.id, `0x${"7".repeat(64)}`);
    expect((await reload(canceled.id)).txHash).toBeNull();
  });

  it("refuses a hash already recorded for a live transfer", async () => {
    const { merchant, transfer } = await preparedDirect();
    await createTransfer(merchant, { status: "completed", txHash: EVM_HASH.toLowerCase() });
    await expect(reportTransferTx(transfer.id, merchant.id, EVM_HASH)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("already recorded for another transfer"),
    });
  });

  it("does not find another business's transfer", async () => {
    const { transfer } = await preparedDirect();
    const stranger = await createMerchant();
    await expect(reportTransferTx(transfer.id, stranger.id, EVM_HASH)).rejects.toMatchObject({ status: 404 });
  });

  it("reports a swap's deposit to 1Click with its memo", async () => {
    const merchant = await createMerchant();
    const transfer = await createTransfer(merchant, {
      sourceAsset: NEAR_TOKEN,
      destinationAsset: USDC_BASE,
      depositAddress: "deposit.near",
      depositMemo: "memo-1",
      correlationId: "corr-swap",
    });
    const nearHash = "9".repeat(44);
    await reportTransferTx(transfer.id, merchant.id, nearHash);
    expect((await reload(transfer.id)).txHash).toBe(nearHash);
    expect(oneClick.submitDeposit).toHaveBeenCalledWith(nearHash, "deposit.near", "memo-1");
  });

  it("accepts a swap the worker already saw reach 1Click, filling in a hash only when 1Click gave none", async () => {
    const merchant = await createMerchant();
    const swap = { sourceAsset: NEAR_TOKEN, destinationAsset: USDC_BASE, depositAddress: "deposit.near", correlationId: "corr-seen", status: "processing" as const };
    const withoutHash = await createTransfer(merchant, swap);
    const withHash = await createTransfer(merchant, { ...swap, correlationId: "corr-seen-2", txHash: "8".repeat(44) });
    const reportsBefore = oneClick.submitDeposit.mock.calls.length;
    await reportTransferTx(withoutHash.id, merchant.id, "9".repeat(44));
    await reportTransferTx(withHash.id, merchant.id, "7".repeat(44));
    expect((await reload(withoutHash.id)).txHash).toBe("9".repeat(44));
    expect((await reload(withHash.id)).txHash).toBe("8".repeat(44));
    expect(oneClick.submitDeposit.mock.calls.length).toBe(reportsBefore);
  });

  it("keeps NEAR hashes as written, since base58 is case-sensitive", async () => {
    const merchant = await createMerchant();
    const transfer = await createTransfer(merchant, { sourceAsset: NEAR_TOKEN, destinationAsset: NEAR_TOKEN, depositAddress: "bob.near" });
    await reportTransferTx(transfer.id, merchant.id, "AbCdEfGhJk".repeat(4) + "AbCd");
    expect((await reload(transfer.id)).txHash).toBe("AbCdEfGhJkAbCdEfGhJkAbCdEfGhJkAbCdEfGhJkAbCd");
  });
});

describe("createRefund", () => {
  /** A 25 USDC invoice paid by one completed payment. */
  async function paidInvoice() {
    const merchant = await createMerchant();
    const invoice = await createInvoice(merchant, { status: "paid" });
    const quote = await createQuote(invoice, { oneclickStatus: "SUCCESS" });
    await getDb().invoice.update({ where: { id: invoice.id }, data: { paidQuoteId: quote.id } });
    return { merchant, invoice };
  }

  it("refunds what is left, then refuses while that refund is open", async () => {
    const { merchant, invoice } = await paidInvoice();
    expect((await createRefund(merchant, { invoice_id: invoice.id, amount: "10" })).amount).toBe("10");
    const rest = await createRefund(merchant, { invoice_id: invoice.id });
    expect(rest.amount).toBe("15");
    await expect(createRefund(merchant, { invoice_id: invoice.id })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("of this payment is still open") });
  });

  it("frees the amount of a canceled refund", async () => {
    const { merchant, invoice } = await paidInvoice();
    const first = await createRefund(merchant, { invoice_id: invoice.id });
    await getDb().transfer.update({ where: { id: first.id }, data: { status: "canceled" } });
    expect((await createRefund(merchant, { invoice_id: invoice.id })).amount).toBe("25");
  });
});
