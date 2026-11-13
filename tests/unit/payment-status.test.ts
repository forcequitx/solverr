import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Invoice, type OneClickStatus, Prisma, type Quote } from "@/generated/prisma/client";
import { nextPollDelay, POLL_MS, transition } from "@/lib/payments/apply-status";
import { REPORTED_GRACE_MS, reportedInFlight } from "@/lib/payments/quote";

const NOW = new Date("2026-11-10T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv_1",
    merchantId: "mer_1",
    mode: "live",
    status: "awaiting_payment",
    amount: new Prisma.Decimal("25.00"),
    currency: "USD",
    destinationAsset: "nep141:usdc.near",
    destinationSymbol: "USDC",
    destinationChain: "base",
    destinationDecimals: 6,
    amountOutBase: "25000000",
    orderId: null,
    description: null,
    customerEmail: null,
    redirectUrl: null,
    metadata: null,
    late: false,
    extraPayment: false,
    paidQuoteId: null,
    paidAt: null,
    redeemedAt: null,
    paymentLinkId: null,
    creditAccountId: null,
    creditedAt: null,
    subscriptionId: null,
    payLinkSentAt: null,
    receiptSentAt: null,
    telegramNotifiedAt: null,
    expiresAt: new Date(NOW.getTime() + 30 * 60_000),
    createdAt: minutesAgo(30),
    updatedAt: minutesAgo(1),
    ...overrides,
  };
}

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: "quo_1",
    invoiceId: "inv_1",
    originAsset: "nep141:eth.omft.near",
    originSymbol: "ETH",
    originChain: "eth",
    originDecimals: 18,
    depositAddress: "0x3333333333333333333333333333333333333333",
    depositMemo: null,
    amountIn: "10000000000000000",
    amountInFormatted: "0.01",
    minAmountIn: "9900000000000000",
    amountInUsd: "25.10",
    refundTo: "0x1111111111111111111111111111111111111111",
    deadline: new Date(NOW.getTime() + 20 * 60_000),
    timeEstimate: 30,
    state: "active",
    oneclickStatus: "PENDING_DEPOSIT",
    oneclickUpdatedAt: null,
    depositTxHash: null,
    walletSentAt: null,
    watchUntil: null,
    nextPollAt: NOW,
    checkoutSeenAt: null,
    simulatedOutcome: null,
    simulatedAt: null,
    correlationId: "corr-1",
    signature: "ed25519:sig",
    rawResponse: {},
    createdAt: minutesAgo(1),
    updatedAt: minutesAgo(1),
    ...overrides,
  };
}

const latestPending = { oneclickStatus: "PENDING_DEPOSIT" as OneClickStatus };

describe("transition of the invoice when a quote's status changes", () => {
  it("marks the invoice paid on success, on time when the deposit arrived before expiry", () => {
    expect(transition(invoice(), quote(), "SUCCESS", null, minutesAgo(1), false)).toMatchObject({
      data: { status: "paid", paidQuoteId: "quo_1", late: false },
      event: "invoice.paid",
    });
  });

  it("marks a success late when the deposit arrived after expiry or went to a retired address", () => {
    const expired = invoice({ expiresAt: minutesAgo(10) });
    expect(transition(expired, quote(), "SUCCESS", null, minutesAgo(5), false)?.data).toMatchObject({ late: true });
    expect(transition(invoice(), quote({ state: "retired" }), "SUCCESS", null, minutesAgo(1), false)?.data).toMatchObject({ late: true });
  });

  it("is not late when the deposit was on time and only the swap finished after expiry", () => {
    expect(transition(invoice({ expiresAt: minutesAgo(1) }), quote(), "SUCCESS", null, minutesAgo(5), false)?.data).toMatchObject({ late: false });
  });

  it("detects a known deposit once", () => {
    expect(transition(invoice(), quote(), "KNOWN_DEPOSIT_TX", null, NOW, false)).toEqual({ data: { status: "detected" }, event: "invoice.detected" });
    expect(transition(invoice({ status: "processing" }), quote(), "KNOWN_DEPOSIT_TX", null, NOW, false)).toBeUndefined();
  });

  it("sends invoice.detected when processing starts before detection, and no second event after it", () => {
    expect(transition(invoice(), quote(), "PROCESSING", null, NOW, false)).toEqual({ data: { status: "processing" }, event: "invoice.detected" });
    expect(transition(invoice({ status: "detected" }), quote(), "PROCESSING", null, NOW, false)).toEqual({ data: { status: "processing" }, event: undefined });
    expect(transition(invoice({ status: "processing" }), quote(), "PROCESSING", null, NOW, false)).toBeUndefined();
  });

  it("marks the latest quote's underpaid, refunded and failed outcomes", () => {
    expect(transition(invoice(), quote(), "INCOMPLETE_DEPOSIT", null, NOW, false)).toEqual({ data: { status: "underpaid" }, event: "invoice.underpaid" });
    expect(transition(invoice(), quote(), "REFUNDED", null, NOW, false)).toEqual({ data: { status: "refunded" }, event: "invoice.refunded" });
    expect(transition(invoice(), quote(), "FAILED", null, NOW, false)).toMatchObject({ data: { status: "failed" }, event: "invoice.failed", supportCase: true });
  });

  it("returns a detected invoice to the latest quote's state when an older quote ends unpaid", () => {
    const detected = invoice({ status: "detected" });
    expect(transition(detected, quote(), "REFUNDED", latestPending, NOW, false)).toEqual({ data: { status: "awaiting_payment" }, restored: true });
    expect(transition(detected, quote(), "INCOMPLETE_DEPOSIT", latestPending, NOW, false)).toEqual({ data: { status: "awaiting_payment" }, restored: true });
  });

  it("expires instead, with invoice.expired, when the invoice ran out of time meanwhile", () => {
    const detected = invoice({ status: "detected", expiresAt: minutesAgo(1) });
    expect(transition(detected, quote(), "REFUNDED", latestPending, NOW, false)).toEqual({ data: { status: "expired" }, event: "invoice.expired", restored: true });
  });

  it("sends the latest quote's outcome when a detected invoice falls back to it", () => {
    const detected = invoice({ status: "processing" });
    expect(transition(detected, quote(), "REFUNDED", { oneclickStatus: "REFUNDED" }, NOW, false)).toEqual({ data: { status: "refunded" }, event: "invoice.refunded", restored: true });
    expect(transition(detected, quote(), "REFUNDED", { oneclickStatus: "INCOMPLETE_DEPOSIT" }, NOW, false)).toEqual({
      data: { status: "underpaid" },
      event: "invoice.underpaid",
      restored: true,
    });
    expect(transition(detected, quote(), "FAILED", { oneclickStatus: "FAILED" }, NOW, false)).toMatchObject({ data: { status: "failed" }, event: "invoice.failed", restored: true, supportCase: true });
  });

  it("opens a support case without an invoice event when an older quote fails", () => {
    const change = transition(invoice({ status: "detected" }), quote(), "FAILED", latestPending, NOW, false);
    expect(change).toMatchObject({ data: { status: "awaiting_payment" }, event: undefined, supportCase: true });
  });

  it("leaves the invoice alone when an older quote ends while the invoice waits on the latest", () => {
    expect(transition(invoice(), quote(), "REFUNDED", latestPending, NOW, false)).toBeUndefined();
  });

  it("does not let one payment's end decide the invoice while another is still moving", () => {
    expect(transition(invoice({ status: "processing" }), quote(), "REFUNDED", null, NOW, true)).toBeUndefined();
    expect(transition(invoice({ status: "processing" }), quote(), "INCOMPLETE_DEPOSIT", null, NOW, true)).toBeUndefined();
    expect(transition(invoice({ status: "processing" }), quote(), "FAILED", null, NOW, true)).toMatchObject({ data: {}, supportCase: true });
  });

  it("flags a second successful payment on a paid invoice as an extra payment", () => {
    const paid = invoice({ status: "paid", paidQuoteId: "quo_first" });
    expect(transition(paid, quote({ id: "quo_second" }), "SUCCESS", null, NOW, false)).toMatchObject({
      data: { extraPayment: true },
      event: "invoice.extra_payment",
    });
    expect(transition(paid, quote({ id: "quo_first" }), "SUCCESS", null, NOW, false)).toBeUndefined();
  });

  it("opens a support case for a second payment that fails on a paid invoice, and ignores other statuses", () => {
    const paid = invoice({ status: "paid", paidQuoteId: "quo_first" });
    expect(transition(paid, quote({ id: "quo_second" }), "FAILED", null, NOW, false)).toMatchObject({ data: {}, supportCase: true });
    expect(transition(paid, quote({ id: "quo_second" }), "REFUNDED", null, NOW, false)).toBeUndefined();
    expect(transition(paid, quote({ id: "quo_second" }), "KNOWN_DEPOSIT_TX", null, NOW, false)).toBeUndefined();
  });
});

describe("nextPollDelay", () => {
  it("polls a moving payment every 10 seconds", () => {
    for (const status of ["KNOWN_DEPOSIT_TX", "PROCESSING", "INCOMPLETE_DEPOSIT"] as const) {
      expect(nextPollDelay(quote(), status)).toBe(POLL_MS.moving);
    }
  });

  it("polls every 5 seconds while the checkout is open", () => {
    expect(nextPollDelay(quote({ checkoutSeenAt: new Date(NOW.getTime() - 10_000) }), "PENDING_DEPOSIT")).toBe(POLL_MS.checkoutOpen);
  });

  it("slows to once a minute for an address nobody looked at for 10 minutes", () => {
    expect(nextPollDelay(quote({ checkoutSeenAt: minutesAgo(11) }), "PENDING_DEPOSIT")).toBe(POLL_MS.activeIdle);
    expect(nextPollDelay(quote({ createdAt: minutesAgo(11) }), "PENDING_DEPOSIT")).toBe(POLL_MS.activeIdle);
    expect(nextPollDelay(quote({ checkoutSeenAt: minutesAgo(5) }), "PENDING_DEPOSIT")).toBe(POLL_MS.active);
  });

  it("keeps a reported payment at the normal pace while its report still counts", () => {
    const reported = quote({ checkoutSeenAt: minutesAgo(30), depositTxHash: "0xabc", deadline: minutesAgo(10) });
    expect(nextPollDelay(reported, "PENDING_DEPOSIT")).toBe(POLL_MS.active);
    const stale = quote({ checkoutSeenAt: minutesAgo(200), depositTxHash: "0xabc", deadline: minutesAgo(61) });
    expect(nextPollDelay(stale, "PENDING_DEPOSIT")).toBe(POLL_MS.activeIdle);
  });

  it("polls retired addresses rarely, unless a payment to them was reported", () => {
    expect(nextPollDelay(quote({ state: "retired" }), "PENDING_DEPOSIT")).toBe(POLL_MS.retired);
    expect(nextPollDelay(quote({ state: "retired", createdAt: minutesAgo(121) }), "PENDING_DEPOSIT")).toBe(POLL_MS.retiredIdle);
    expect(nextPollDelay(quote({ state: "retired", depositTxHash: "0xabc", deadline: minutesAgo(5) }), "PENDING_DEPOSIT")).toBe(POLL_MS.active);
  });

  it("follows the simulated step beat for a test payment", () => {
    expect(nextPollDelay(quote({ simulatedAt: new Date(NOW.getTime() - 1_000) }), "PENDING_DEPOSIT")).toBe(3_050);
  });
});

describe("reportedInFlight", () => {
  const reported = (overrides: Partial<Pick<Quote, "depositTxHash" | "walletSentAt" | "oneclickStatus" | "deadline">>) =>
    reportedInFlight({ depositTxHash: "0xabc", walletSentAt: null, oneclickStatus: "PENDING_DEPOSIT", deadline: NOW, ...overrides });

  it("counts a reported hash that 1Click has not seen yet", () => {
    expect(reported({})).toBe(true);
  });

  it("stops counting the report an hour after the address's deadline", () => {
    expect(reported({ deadline: new Date(NOW.getTime() - REPORTED_GRACE_MS + 1_000) })).toBe(true);
    expect(reported({ deadline: new Date(NOW.getTime() - REPORTED_GRACE_MS) })).toBe(false);
  });

  it("does not count a quote without a report, or one 1Click already moved", () => {
    expect(reported({ depositTxHash: null })).toBe(false);
    expect(reported({ oneclickStatus: "KNOWN_DEPOSIT_TX" })).toBe(false);
  });
});
