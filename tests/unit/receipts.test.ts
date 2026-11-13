import { describe, expect, it } from "vitest";
import { receiptStillSent } from "@/lib/payments/receipts";
import { DAY_MS } from "@/lib/time";

describe("receiptStillSent", () => {
  const paidDaysAgo = (days: number) => ({ status: "paid", paidAt: new Date(Date.now() - days * DAY_MS) });

  it("offers a receipt for a payment not paid yet, or paid within the job's week", () => {
    expect(receiptStillSent({ status: "awaiting_payment", paidAt: null })).toBe(true);
    expect(receiptStillSent(paidDaysAgo(6.9))).toBe(true);
  });

  it("stops offering one the receipt job would never send", () => {
    expect(receiptStillSent(paidDaysAgo(7.1))).toBe(false);
    expect(receiptStillSent({ status: "paid", paidAt: null })).toBe(false);
  });
});
