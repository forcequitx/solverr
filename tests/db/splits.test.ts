import { describe, expect, it } from "vitest";
import type { Invoice, Merchant, Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/ids";
import { lockInvoice } from "@/lib/row-locks";
import { addSplitRule, resizeSplitPayouts } from "@/lib/splits/splits";
import { cancelTransfer } from "@/lib/transfers/execute";
import { SPLIT_ON_HOLD, splitOnHold } from "@/lib/transfers/kinds";
import { createRefund } from "@/lib/transfers/transfers";
import { createInvoice, createMerchant, PAYOUT_ADDRESS, USDC_BASE } from "./factories";
import { payInvoice } from "./settle";

const PARTNER = "0x5555555555555555555555555555555555555555";
const AGENCY = "0x6666666666666666666666666666666666666666";

/** A split rule as stored, for setting up a rule `addSplitRule` would refuse today (another network). */
function createSplitRule(merchant: Pick<Merchant, "id">, data: Pick<Prisma.SplitRuleUncheckedCreateInput, "label" | "recipient" | "chain" | "shareBps">) {
  return getDb().splitRule.create({ data: { id: newId("spl"), merchantId: merchant.id, ...data } });
}

const splitPayouts = (invoiceId: string) =>
  getDb().transfer.findMany({ where: { invoiceId, kind: "payout", splitShareBps: { not: null } }, orderBy: { splitShareBps: "desc" } });

/** Split payout alert texts in alphabetical order; alerts saved in one transaction can share a timestamp. */
const alertsOf = async (merchantId: string) => (await getDb().alert.findMany({ where: { merchantId, kind: "split_payouts" } })).map((alert) => alert.message).sort();

/** A business with the given split rules on Base and an invoice of `amountOutBase` USDC base units, paid through the status path. */
async function paidWithSplits(rules: { label: string; recipient: string; percent: string }[], amountOutBase = "25000000"): Promise<{ merchant: Merchant; invoice: Invoice }> {
  const merchant = await createMerchant();
  for (const rule of rules) await addSplitRule(merchant, rule);
  const invoice = await createInvoice(merchant, { amountOutBase });
  await payInvoice(invoice);
  return { merchant, invoice };
}

describe("addSplitRule", () => {
  it("stores the share in basis points and the payout network the recipient was given for", async () => {
    const merchant = await createMerchant();
    await addSplitRule(merchant, { label: "Partner", recipient: PARTNER, percent: "2.5" });
    expect(await getDb().splitRule.findFirstOrThrow({ where: { merchantId: merchant.id } })).toMatchObject({ label: "Partner", recipient: PARTNER, chain: "base", shareBps: 250 });
  });

  it("refuses a recipient that is not an address on the payout network, and a business without a payout network", async () => {
    const merchant = await createMerchant();
    await expect(addSplitRule(merchant, { label: "Partner", recipient: "alice.near", percent: "10" })).rejects.toMatchObject({
      status: 400,
      message: "The recipient must be a valid Base address.",
    });
    const unverified = await createMerchant({ payoutChain: null, payoutAddress: null, payoutVerifiedAt: null });
    await expect(addSplitRule(unverified, { label: "Partner", recipient: PARTNER, percent: "10" })).rejects.toMatchObject({ status: 400 });
    expect(await getDb().splitRule.count()).toBe(0);
  });

  it("keeps all splits together at 100% or less, also when two are added at once", async () => {
    const merchant = await createMerchant();
    await addSplitRule(merchant, { label: "Partner", recipient: PARTNER, percent: "40" });
    await expect(addSplitRule(merchant, { label: "Agency", recipient: AGENCY, percent: "60.01" })).rejects.toMatchObject({
      status: 400,
      message: "All splits together can be at most 100%.",
    });

    const results = await Promise.allSettled([
      addSplitRule(merchant, { label: "Agency", recipient: AGENCY, percent: "60" }),
      addSplitRule(merchant, { label: "Studio", recipient: AGENCY, percent: "60" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const total = await getDb().splitRule.aggregate({ where: { merchantId: merchant.id }, _sum: { shareBps: true } });
    expect(total._sum.shareBps).toBe(10_000);
  });

  it("does not count splits for an earlier payout network, which are not paid, toward the 100%", async () => {
    const merchant = await createMerchant();
    await createSplitRule(merchant, { label: "Old Solana partner", recipient: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", chain: "sol", shareBps: 6_000 });
    await addSplitRule(merchant, { label: "Partner", recipient: PARTNER, percent: "60" });
    await expect(addSplitRule(merchant, { label: "Agency", recipient: AGENCY, percent: "40.01" })).rejects.toMatchObject({ message: "All splits together can be at most 100%." });
  });
});

describe("split payouts of a paid invoice", () => {
  it("creates one pending payout per rule, in exact base units, in one batch", async () => {
    const { merchant, invoice } = await paidWithSplits([
      { label: "Partner", recipient: PARTNER, percent: "10" },
      { label: "Agency", recipient: AGENCY, percent: "2.5" },
    ]);

    const payouts = await splitPayouts(invoice.id);
    expect(payouts.map((payout) => [payout.recipient, payout.splitShareBps, payout.amount])).toEqual([
      [PARTNER, 1000, "2.5"],
      [AGENCY, 250, "0.625"],
    ]);
    for (const payout of payouts) {
      expect(payout).toMatchObject({ merchantId: merchant.id, kind: "payout", status: "pending", sourceAsset: USDC_BASE, destinationAsset: USDC_BASE, depositAddress: null });
    }
    expect(payouts[0].batchId).not.toBeNull();
    expect(payouts[1].batchId).toBe(payouts[0].batchId);
    expect(await alertsOf(merchant.id)).toEqual([`2 split payouts for payment ${invoice.id} are ready to approve in Refunds & payouts.`]);
  });

  it("rounds each share down to a whole base unit and skips a share of nothing", async () => {
    const odd = await paidWithSplits([{ label: "Partner", recipient: PARTNER, percent: "33.33" }], "1000001");
    expect((await splitPayouts(odd.invoice.id)).map((payout) => payout.amount)).toEqual(["0.3333"]);

    const tiny = await paidWithSplits([{ label: "Partner", recipient: PARTNER, percent: "0.01" }], "9999");
    expect(await splitPayouts(tiny.invoice.id)).toEqual([]);
    expect(await alertsOf(tiny.merchant.id)).toEqual([]);
  });

  it("skips a rule added for another network and tells the business", async () => {
    const merchant = await createMerchant();
    await createSplitRule(merchant, { label: "Old Solana partner", recipient: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", chain: "sol", shareBps: 500 });
    await createSplitRule(merchant, { label: "Partner", recipient: PARTNER, chain: "base", shareBps: 1000 });
    const invoice = await createInvoice(merchant);
    await payInvoice(invoice);

    expect((await splitPayouts(invoice.id)).map((payout) => payout.recipient)).toEqual([PARTNER]);
    expect(await alertsOf(merchant.id)).toEqual([
      `1 split payout for payment ${invoice.id} is ready to approve in Refunds & payouts.`,
      `No payout was created for payment ${invoice.id} for these splits, because they were added for another network than Base: Old Solana partner. Add them again in Settings → Revenue splits with a Base address.`,
    ]);
  });

  it("creates no second set for an extra payment", async () => {
    const { invoice } = await paidWithSplits([{ label: "Partner", recipient: PARTNER, percent: "10" }]);
    await payInvoice(invoice);
    expect(await getDb().invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({ extraPayment: true });
    expect(await splitPayouts(invoice.id)).toHaveLength(1);
  });

  it("creates none for a demo store (test mode) invoice, which moves no money", async () => {
    const merchant = await createMerchant();
    await addSplitRule(merchant, { label: "Partner", recipient: PARTNER, percent: "10" });
    const invoice = await createInvoice(merchant, { mode: "test" });
    await payInvoice(invoice);

    expect(await getDb().invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({ status: "paid" });
    expect(await splitPayouts(invoice.id)).toEqual([]);
    expect(await alertsOf(merchant.id)).toEqual([]);
  });
});

describe("split payouts after refunds", () => {
  it("shrink with an open refund and grow back when it is canceled", async () => {
    const { merchant, invoice } = await paidWithSplits([{ label: "Partner", recipient: PARTNER, percent: "10" }]);
    const refund = await createRefund(merchant, { invoice_id: invoice.id, amount: "10" });
    expect((await splitPayouts(invoice.id))[0].amount).toBe("1.5");

    await cancelTransfer(refund.id, merchant.id);
    expect((await splitPayouts(invoice.id))[0].amount).toBe("2.5");
  });

  it("wait at nothing while a full refund is open, and are canceled once it completes", async () => {
    const { merchant, invoice } = await paidWithSplits([{ label: "Partner", recipient: PARTNER, percent: "10" }]);
    const refund = await createRefund(merchant, { invoice_id: invoice.id });
    const [held] = await splitPayouts(invoice.id);
    expect(held).toMatchObject({ amount: "0", status: "pending" });
    expect(splitOnHold(held)).toBe(true);
    /** Canceling it now would lose the share if the refund then failed. */
    await expect(cancelTransfer(held.id, merchant.id)).rejects.toMatchObject({ status: 409, message: SPLIT_ON_HOLD });

    await getDb().transfer.update({ where: { id: refund.id }, data: { status: "completed" } });
    await getDb().$transaction(async (tx) => {
      await lockInvoice(tx, invoice.id);
      await resizeSplitPayouts(tx, invoice.id);
    });
    expect((await splitPayouts(invoice.id))[0]).toMatchObject({ status: "canceled", failureReason: "The payment was refunded, so no share is left to pay." });
  });

  it("leave a split payout that was already prepared for sending", async () => {
    const { merchant, invoice } = await paidWithSplits([{ label: "Partner", recipient: PARTNER, percent: "10" }]);
    const [split] = await splitPayouts(invoice.id);
    await getDb().transfer.update({ where: { id: split.id }, data: { depositAddress: PARTNER, txSender: PAYOUT_ADDRESS } });

    await createRefund(merchant, { invoice_id: invoice.id, amount: "10" });
    expect((await splitPayouts(invoice.id))[0].amount).toBe("2.5");
  });

  it("do not change for a refund of an extra payment", async () => {
    const { merchant, invoice } = await paidWithSplits([{ label: "Partner", recipient: PARTNER, percent: "10" }]);
    const extra = await payInvoice(invoice);
    await createRefund(merchant, { invoice_id: invoice.id, payment_id: extra.id });
    expect((await splitPayouts(invoice.id))[0].amount).toBe("2.5");
  });
});
