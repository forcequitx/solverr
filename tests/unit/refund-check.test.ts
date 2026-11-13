import { describe, expect, it } from "vitest";
import type { TransferStatus } from "@/generated/prisma/client";
import { checkRefund } from "@/lib/transfers/transfers";

/** A paid invoice that settled 25 USDC on Base, paid by `quo_paid`, with a later extra payment `quo_extra`. */
const invoice = {
  status: "paid" as const,
  destinationChain: "base",
  amountOutBase: "25000000",
  destinationDecimals: 6,
  destinationSymbol: "USDC",
  paidQuoteId: "quo_paid",
  quotes: [
    { id: "quo_paid", oneclickStatus: "SUCCESS" as const },
    { id: "quo_extra", oneclickStatus: "SUCCESS" as const },
    { id: "quo_failed", oneclickStatus: "FAILED" as const },
  ],
};

let refundCount = 0;
const refund = (amount: string, status: TransferStatus, quoteId = "quo_paid") => ({ id: `ref_${++refundCount}`, amount, status, quoteId });

describe("checkRefund", () => {
  it("allows the whole settled amount of the paying payment by default", () => {
    const check = checkRefund(invoice, "base", []);
    expect(check).toMatchObject({ ok: true, amount: 25_000_000n, refunded: 0n, payment: { id: "quo_paid" } });
  });

  it("leaves out failed and canceled refunds and refunds of other payments", () => {
    const refunds = [refund("10", "completed"), refund("5", "failed"), refund("5", "canceled"), refund("20", "completed", "quo_extra")];
    expect(checkRefund(invoice, "base", refunds)).toMatchObject({ ok: true, amount: 15_000_000n, refunded: 10_000_000n });
  });

  it("refuses an invoice that is not paid", () => {
    const check = checkRefund({ ...invoice, status: "expired" }, "base", []);
    expect(check).toMatchObject({ ok: false, reason: "not_paid", error: { status: 409, message: "Only paid invoices can be refunded." } });
  });

  it("refuses a payment that settled on another network than the payout network", () => {
    expect(checkRefund(invoice, "arbitrum", [])).toMatchObject({ ok: false, reason: "payout_network", error: { status: 409 } });
    expect(checkRefund(invoice, null, [])).toMatchObject({ ok: true });
  });

  it("refuses a payment that did not complete", () => {
    expect(checkRefund(invoice, "base", [], { paymentId: "quo_failed" })).toMatchObject({ ok: false, reason: "no_payment", error: { status: 404, param: "payment_id" } });
  });

  it("names the open refund that holds what is left", () => {
    const open = refund("25", "pending");
    const check = checkRefund(invoice, "base", [open]);
    expect(check).toMatchObject({ ok: false, reason: "refund_open", error: { status: 409, message: expect.stringContaining(open.id) } });
  });

  it("refuses a payment refunded in full", () => {
    const check = checkRefund(invoice, "base", [refund("20", "completed"), refund("5", "completed")]);
    expect(check).toMatchObject({ ok: false, reason: "refunded", error: { status: 409, message: "At most 0 USDC of this payment can still be refunded.", param: "amount" } });
  });

  it("checks a requested amount against what is left and the coin's decimals", () => {
    const refunds = [refund("10", "processing")];
    expect(checkRefund(invoice, "base", refunds, { amount: "15" })).toMatchObject({ ok: true, amount: 15_000_000n });
    expect(checkRefund(invoice, "base", refunds, { amount: "15.5" })).toMatchObject({ ok: false, reason: "amount", error: { message: "At most 15 USDC of this payment can still be refunded." } });
    expect(checkRefund(invoice, "base", refunds, { amount: "1.0000001" })).toMatchObject({ ok: false, reason: "precision", error: { status: 400 } });
  });

  it("refunds an extra payment up to the invoice's settled amount", () => {
    const refunds = [refund("25", "completed")];
    expect(checkRefund(invoice, "base", refunds, { paymentId: "quo_extra" })).toMatchObject({ ok: true, amount: 25_000_000n, payment: { id: "quo_extra" } });
  });
});
