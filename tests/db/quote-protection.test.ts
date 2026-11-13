import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice, Quote } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import type { QuoteRequest } from "@/lib/oneclick/types";
import { subscribeCheckout } from "@/lib/payments/checkout-events";
import { getCheckoutState } from "@/lib/payments/checkout-state";
import { reportDeposit, reportDepositSchema, reportWalletSent } from "@/lib/payments/deposit";
import { estimatePayments } from "@/lib/payments/estimate";
import { createQuote, REPORTED_GRACE_MS, reportedInFlight } from "@/lib/payments/quote";
import { createInvoice, createMerchant, createQuote as createQuoteRow, ETH, PAYOUT_ADDRESS, USDC_BASE } from "./factories";

/** Live invoices get their addresses from the test-mode stand-in for 1Click; `during` runs while a quote is being asked for.
    A reported transaction is accepted while 1Click has not seen it yet, so its status stays unchanged. */
const network = vi.hoisted(() => {
  const state = { during: undefined as (() => Promise<void>) | undefined };
  const quote = vi.fn(async (request: QuoteRequest) => {
    await state.during?.();
    const { mockQuote } = await import("@/lib/oneclick/mock");
    return mockQuote(request);
  });
  const reportDeposit = vi.fn(async (row: Quote) => {
    const { oneClickStatus } = await import("./settle");
    return oneClickStatus(row, "PENDING_DEPOSIT");
  });
  return { state, quote, reportDeposit };
});

vi.mock("@/lib/oneclick/network", () => ({ paymentNetwork: () => ({ quote: network.quote, estimate: network.quote, reportDeposit: network.reportDeposit }) }));

vi.mock("@/lib/oneclick/tokens", async (importOriginal) => {
  const { TEST_TOKENS } = await import("./factories");
  return {
    ...(await importOriginal<typeof import("@/lib/oneclick/tokens")>()),
    findToken: async (assetId: string) => TEST_TOKENS.find((token) => token.assetId === assetId),
  };
});

const REFUND_A = "0x1111111111111111111111111111111111111111";
const REFUND_B = "0x3333333333333333333333333333333333333333";
const PAYMENT_ALREADY_SENT = "A payment was already sent for this invoice. Wait for it to arrive and do not send it again.";
const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);

const ask = (invoice: Pick<Invoice, "id">, refundAddress = REFUND_A, originAsset = ETH) => createQuote(invoice.id, { origin_asset: originAsset, refund_address: refundAddress });
const quotesOf = (invoice: Pick<Invoice, "id">) => getDb().quote.findMany({ where: { invoiceId: invoice.id }, orderBy: { createdAt: "asc" } });

beforeEach(() => {
  network.state.during = undefined;
});

/** An open live invoice of a business whose payout wallet is verified on Base. */
async function openInvoice(): Promise<Invoice> {
  return createInvoice(await createMerchant());
}

/** An open address on `invoice` for ETH refunding to REFUND_A, shaped as `createQuote` stores it, so it can be reused. */
function openAddress(invoice: Pick<Invoice, "id">, overrides: Parameters<typeof createQuoteRow>[1] = {}) {
  return createQuoteRow(invoice, { originAsset: ETH, refundTo: REFUND_A, rawResponse: { quoteRequest: { recipient: PAYOUT_ADDRESS } }, ...overrides });
}

describe("createQuote double-payment protection", () => {
  it("returns the open address for the same coin and refund address instead of asking for a new one", async () => {
    const invoice = await openInvoice();
    const first = await ask(invoice);
    const again = await ask(invoice);

    expect(again).toEqual({ quote: first.quote, destinationChain: "base" });
    expect(network.quote).toHaveBeenCalledTimes(1);
    expect(await quotesOf(invoice)).toHaveLength(1);
  });

  it("replaces the open address for another refund address or coin, keeping the old one watched for a day", async () => {
    const invoice = await openInvoice();
    const first = await ask(invoice, REFUND_A);
    const second = await ask(invoice, REFUND_B);
    const third = await ask(invoice, REFUND_B, USDC_BASE);

    expect(new Set([first.quote.id, second.quote.id, third.quote.id]).size).toBe(3);
    expect(network.quote).toHaveBeenCalledTimes(3);
    const quotes = await quotesOf(invoice);
    expect(quotes.map((quote) => quote.state)).toEqual(["retired", "retired", "active"]);
    expect(quotes[0].watchUntil!.getTime()).toBeGreaterThan(minutesFromNow(23 * 60).getTime());
    expect(await getDb().invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({ status: "awaiting_payment" });
  });

  it("reuses a matching open address only while more than two minutes of it are left", async () => {
    const invoice = await openInvoice();
    const lasting = await openAddress(invoice, { deadline: minutesFromNow(10) });
    expect((await ask(invoice)).quote.id).toBe(lasting.id);
    expect(network.quote).not.toHaveBeenCalled();

    await getDb().quote.update({ where: { id: lasting.id }, data: { deadline: minutesFromNow(1) } });
    expect((await ask(invoice)).quote.id).not.toBe(lasting.id);
    expect(network.quote).toHaveBeenCalledTimes(1);
  });

  it("refuses a new address while a reported payment is on its way, also to a retired address", async () => {
    const invoice = await openInvoice();
    const reported = await openAddress(invoice, { depositTxHash: `0x${"ab".repeat(32)}`, deadline: minutesFromNow(10) });
    const refusal = { status: 409, type: "invalid_state", code: "payment_in_progress", message: PAYMENT_ALREADY_SENT };

    await expect(ask(invoice, REFUND_B)).rejects.toMatchObject(refusal);
    await getDb().quote.update({ where: { id: reported.id }, data: { state: "retired" } });
    await expect(ask(invoice, REFUND_B)).rejects.toMatchObject(refusal);

    expect(network.quote).not.toHaveBeenCalled();
    expect(await quotesOf(invoice)).toHaveLength(1);
  });

  it("keeps refusing until the reported address's deadline plus the grace period, then allows a new address", async () => {
    const invoice = await openInvoice();
    const graceMinutes = REPORTED_GRACE_MS / 60_000;
    const reported = await openAddress(invoice, { depositTxHash: `0x${"ab".repeat(32)}`, deadline: minutesFromNow(1 - graceMinutes) });
    await expect(ask(invoice, REFUND_B)).rejects.toMatchObject({ status: 409, code: "payment_in_progress" });

    await getDb().quote.update({ where: { id: reported.id }, data: { deadline: minutesFromNow(-1 - graceMinutes) } });
    const fresh = await ask(invoice, REFUND_B);
    expect(fresh.quote).toMatchObject({ state: "active", refundTo: REFUND_B });
    expect(await getDb().quote.findUniqueOrThrow({ where: { id: reported.id } })).toMatchObject({ state: "retired" });
  });

  it("does not count a reported transaction that NEAR Intents already finished", async () => {
    const merchant = await createMerchant();
    const invoice = await createInvoice(merchant, { status: "refunded" });
    await openAddress(invoice, { depositTxHash: `0x${"ab".repeat(32)}`, oneclickStatus: "REFUNDED", state: "final" });

    expect((await ask(invoice, REFUND_B)).quote).toMatchObject({ state: "active", refundTo: REFUND_B });
    expect(await getDb().invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({ status: "awaiting_payment" });
  });

  it("checks again under the invoice lock, so a report saved during the 1Click call stops the new address", async () => {
    const invoice = await openInvoice();
    const open = await openAddress(invoice, { deadline: minutesFromNow(10) });
    network.state.during = async () => {
      await getDb().quote.update({ where: { id: open.id }, data: { depositTxHash: `0x${"cd".repeat(32)}` } });
    };

    await expect(ask(invoice, REFUND_B)).rejects.toMatchObject({ status: 409, code: "payment_in_progress", message: PAYMENT_ALREADY_SENT });
    expect(network.quote).toHaveBeenCalledTimes(1);
    expect((await quotesOf(invoice)).map((quote) => [quote.id, quote.state])).toEqual([[open.id, "active"]]);
  });

  it("refuses the new address when the business moves its payout network during the 1Click call, even with the same address", async () => {
    const invoice = await openInvoice();
    network.state.during = async () => {
      await getDb().merchant.update({ where: { id: invoice.merchantId }, data: { payoutChain: "arb" } });
    };

    await expect(ask(invoice)).rejects.toMatchObject({ status: 409, type: "invalid_state", message: "The business just changed how it receives payments. Choose your coin again." });
    expect(await quotesOf(invoice)).toEqual([]);
  });

  it("keeps the address an identical request stored during the 1Click call, instead of retiring it for a second one", async () => {
    const invoice = await openInvoice();
    let stored: Quote | undefined;
    network.state.during = async () => {
      stored = await openAddress(invoice, { deadline: minutesFromNow(10) });
    };

    const result = await ask(invoice);
    expect(result.quote.id).toBe(stored!.id);
    expect((await quotesOf(invoice)).map((quote) => [quote.id, quote.state])).toEqual([[stored!.id, "active"]]);
  });

  it("leaves a single open address when two checkouts ask at the same time", async () => {
    const invoice = await openInvoice();
    const results = await Promise.all([ask(invoice, REFUND_A), ask(invoice, REFUND_B)]);

    expect(results[0].quote.id).not.toBe(results[1].quote.id);
    const states = (await quotesOf(invoice)).map((quote) => quote.state).sort();
    expect(states).toEqual(["active", "retired"]);
  });

  it("refuses a paid invoice with the invoice_paid code", async () => {
    const invoice = await createInvoice(await createMerchant(), { status: "paid" });
    await expect(ask(invoice)).rejects.toMatchObject({ status: 409, type: "invalid_state", code: "invoice_paid" });
    expect(network.quote).not.toHaveBeenCalled();
  });

  it("refuses an invoice whose payout network the business left with payout_changed, for an address and for the whole estimate", async () => {
    const invoice = await openInvoice();
    await getDb().merchant.update({ where: { id: invoice.merchantId }, data: { payoutChain: "eth" } });
    await expect(ask(invoice)).rejects.toMatchObject({ status: 409, type: "invalid_state", code: "payout_changed" });
    await expect(estimatePayments(invoice.id, { origin_assets: [ETH, USDC_BASE] })).rejects.toMatchObject({ status: 409, code: "payout_changed" });
    expect(network.quote).not.toHaveBeenCalled();
  });
});

describe("reportDeposit", () => {
  it("tells other open checkouts at once that the payment was sent, though NEAR Intents has not seen it yet", async () => {
    const invoice = await openInvoice();
    await openAddress(invoice, { deadline: minutesFromNow(10) });
    const onChange = vi.fn();
    const unsubscribe = await subscribeCheckout(invoice.id, { onChange, onLost: () => undefined });
    expect(unsubscribe).not.toBeNull();
    try {
      await reportDeposit(invoice.id, `0x${"ab".repeat(32)}`);
      await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
      expect((await getCheckoutState(invoice.id, { markSeen: false }))?.payment).toMatchObject({ reported: true });
    } finally {
      unsubscribe?.();
    }
  });
});

describe("a wallet payment without a transaction hash (TON)", () => {
  it("is remembered as on its way, so a reload does not offer the address again and a new address is refused", async () => {
    const invoice = await openInvoice();
    const { quote } = await ask(invoice);
    await reportWalletSent(invoice.id, quote.id);

    await expect(getDb().quote.findUniqueOrThrow({ where: { id: quote.id } })).resolves.toMatchObject({ walletSentAt: expect.any(Date), depositTxHash: null });
    expect((await getCheckoutState(invoice.id))?.payment?.reported).toBe(true);
    await expect(ask(invoice, REFUND_B)).rejects.toMatchObject({ status: 409, message: PAYMENT_ALREADY_SENT });
  });

  it("is reported with wallet_sent instead of tx_hash, never both or neither", () => {
    const hash = `0x${"ab".repeat(32)}`;
    expect(reportDepositSchema.safeParse({ wallet_sent: true }).success).toBe(true);
    expect(reportDepositSchema.safeParse({ tx_hash: hash }).success).toBe(true);
    expect(reportDepositSchema.safeParse({}).success).toBe(false);
    expect(reportDepositSchema.safeParse({ tx_hash: hash, wallet_sent: true }).success).toBe(false);
    expect(reportDepositSchema.safeParse({ wallet_sent: false }).success).toBe(false);
  });
});

describe("reportedInFlight", () => {
  const reported = { depositTxHash: `0x${"ab".repeat(32)}`, walletSentAt: null, oneclickStatus: "PENDING_DEPOSIT" as const };

  it("counts an unseen report until the deadline plus REPORTED_GRACE_MS", () => {
    expect(REPORTED_GRACE_MS).toBe(60 * 60_000);
    expect(reportedInFlight({ ...reported, deadline: new Date(Date.now() - REPORTED_GRACE_MS + 5_000) })).toBe(true);
    expect(reportedInFlight({ ...reported, deadline: new Date(Date.now() - REPORTED_GRACE_MS - 5_000) })).toBe(false);
  });

  it("does not count an address without a report or one NEAR Intents has seen", () => {
    const deadline = minutesFromNow(10);
    expect(reportedInFlight({ ...reported, depositTxHash: null, deadline })).toBe(false);
    /** A wallet that returns no hash (TON) reports the payment as sent, which counts the same. */
    expect(reportedInFlight({ ...reported, depositTxHash: null, walletSentAt: new Date(), deadline })).toBe(true);
    expect(reportedInFlight({ ...reported, oneclickStatus: "KNOWN_DEPOSIT_TX", deadline })).toBe(false);
  });
});
