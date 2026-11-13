import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { charge, refundCharge, restoreTopUpCredits, topUp } from "@/lib/credits/credits";
import { getDb } from "@/lib/db";
import { applyStatus } from "@/lib/payments/apply-status";
import { cancelTransfer } from "@/lib/transfers/execute";
import { createRefund } from "@/lib/transfers/transfers";
import { createCreditAccount, createInvoice, createMerchant, createQuote } from "./factories";
import { fundCredits, oneClickStatus, payInvoice } from "./settle";

/** Top-ups price their invoice from the token list, which stands in for 1Click here. */
vi.mock("@/lib/oneclick/tokens", async (importOriginal) => {
  const { TEST_TOKENS } = await import("./factories");
  return {
    ...(await importOriginal<typeof import("@/lib/oneclick/tokens")>()),
    findToken: async (assetId: string) => TEST_TOKENS.find((token) => token.assetId === assetId),
  };
});

const CREDIT_TOKEN = /^solverr_credit_[1-9A-HJ-NP-Za-km-z]{32}$/;

const balanceOf = async (accountId: string) => (await getDb().creditAccount.findUniqueOrThrow({ where: { id: accountId } })).balance.toFixed(6);
const usageOf = (accountId: string) => getDb().creditUsage.findMany({ where: { creditAccountId: accountId }, orderBy: { createdAt: "asc" } });

describe("topUp", () => {
  it("creates a credit account with a one-time token and an invoice for the amount", async () => {
    const merchant = await createMerchant();
    const { credit_account, invoice } = await topUp(merchant, { amount: "5", currency: "USD" });

    expect(credit_account).toEqual({ id: expect.stringMatching(/^cra_/), object: "credit_account", token: expect.stringMatching(CREDIT_TOKEN), balance: "0.000000", currency: "USD" });
    expect(invoice).toMatchObject({ amount: "5.00", currency: "USD", status: "created", description: "Agent credits top-up", settlement: { asset_id: expect.any(String), amount: "5", amount_base: "5000000" } });
    const account = await getDb().creditAccount.findUniqueOrThrow({ where: { id: credit_account.id } });
    expect(account.tokenHash).toBe(createHash("sha256").update(credit_account.token!).digest("hex"));
    expect(await getDb().invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({ creditAccountId: account.id, creditedAt: null });
  });

  it("tops up an existing account without handing out its token again", async () => {
    const merchant = await createMerchant();
    const first = await topUp(merchant, { amount: "5", currency: "USD" });
    const again = await topUp(merchant, { amount: "2.50", currency: "USD", credit_account_id: first.credit_account.id });

    expect(again.credit_account).toEqual({ id: first.credit_account.id, object: "credit_account", balance: "0.000000", currency: "USD" });
    expect(again.invoice.amount).toBe("2.50");
    expect(await getDb().creditAccount.count()).toBe(1);
    expect(await getDb().invoice.count({ where: { creditAccountId: first.credit_account.id } })).toBe(2);
  });

  it("does not find another business's credit account", async () => {
    const owner = await createMerchant();
    const stranger = await createMerchant();
    const { credit_account } = await topUp(owner, { amount: "5", currency: "USD" });
    await expect(topUp(stranger, { amount: "5", currency: "USD", credit_account_id: credit_account.id })).rejects.toMatchObject({
      status: 404,
      type: "not_found",
      param: "credit_account_id",
    });
    expect(await getDb().invoice.count({ where: { merchantId: stranger.id } })).toBe(0);
  });
});

describe("top-up crediting", () => {
  it("adds nothing while the payment is only detected", async () => {
    const merchant = await createMerchant();
    const { credit_account, invoice } = await topUp(merchant, { amount: "5", currency: "USD" });
    const quote = await createQuote(invoice);
    await applyStatus(quote.id, oneClickStatus(quote, "KNOWN_DEPOSIT_TX"));
    expect(await balanceOf(credit_account.id)).toBe("0.000000");
  });

  it("adds the amount once when the invoice is paid, and nothing for an extra payment", async () => {
    const merchant = await createMerchant();
    const { accountId, invoiceId } = await fundCredits(merchant, "5");
    expect(await balanceOf(accountId)).toBe("5.000000");
    expect((await getDb().invoice.findUniqueOrThrow({ where: { id: invoiceId } })).creditedAt).not.toBeNull();

    await payInvoice({ id: invoiceId });
    expect(await getDb().invoice.findUniqueOrThrow({ where: { id: invoiceId } })).toMatchObject({ status: "paid", extraPayment: true });
    expect(await balanceOf(accountId)).toBe("5.000000");
  });
});

describe("charge", () => {
  it("takes exactly the amount, to the millionth, and records each charge", async () => {
    const merchant = await createMerchant();
    const { accountId, token } = await fundCredits(merchant, "5");

    const first = await charge(merchant, { token, amount: "1.234567", description: "GET /weather" });
    expect(first).toEqual({ id: expect.stringMatching(/^cru_/), object: "credit_charge", amount: "1.234567", balance: "3.765433", currency: "USD" });
    expect((await charge(merchant, { token, amount: "0.000001" })).balance).toBe("3.765432");

    expect(await balanceOf(accountId)).toBe("3.765432");
    const usage = await usageOf(accountId);
    expect(usage.map((row) => [row.amount.toFixed(6), row.description, row.refundedAt])).toEqual([
      ["1.234567", "GET /weather", null],
      ["0.000001", null, null],
    ]);
  });

  it("refuses a charge above the balance without changing anything, and allows spending it to zero", async () => {
    const merchant = await createMerchant();
    const { accountId, token } = await fundCredits(merchant, "5");

    await expect(charge(merchant, { token, amount: "5.000001" })).rejects.toMatchObject({
      status: 409,
      type: "insufficient_credit",
      message: "This credit balance is too low. Top it up to continue.",
    });
    expect(await balanceOf(accountId)).toBe("5.000000");
    expect(await usageOf(accountId)).toEqual([]);

    expect((await charge(merchant, { token, amount: "5" })).balance).toBe("0.000000");
    await expect(charge(merchant, { token, amount: "0.000001" })).rejects.toMatchObject({ status: 409, type: "insufficient_credit" });
    expect(await balanceOf(accountId)).toBe("0.000000");
  });

  it("does not accept a token of another business or an unknown token", async () => {
    const owner = await createMerchant();
    const stranger = await createMerchant();
    const { accountId, token } = await fundCredits(owner, "5");

    await expect(charge(stranger, { token, amount: "1" })).rejects.toMatchObject({ status: 404, type: "not_found", param: "token" });
    await expect(charge(owner, { token: `solverr_credit_${"1".repeat(32)}`, amount: "1" })).rejects.toMatchObject({ status: 404, param: "token" });
    expect(await balanceOf(accountId)).toBe("5.000000");
  });

  it("lets concurrent charges spend the balance only once", async () => {
    const merchant = await createMerchant();
    const { accountId, token } = await fundCredits(merchant, "3");

    const results = await Promise.allSettled(Array.from({ length: 5 }, () => charge(merchant, { token, amount: "1" })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    for (const result of results.filter((entry) => entry.status === "rejected")) expect(result).toMatchObject({ reason: { status: 409, type: "insufficient_credit" } });
    expect(await balanceOf(accountId)).toBe("0.000000");
    expect(await usageOf(accountId)).toHaveLength(3);
  });
});

describe("refundCharge", () => {
  it("gives a charge back once and refuses a second time", async () => {
    const merchant = await createMerchant();
    const { accountId, token } = await fundCredits(merchant, "5");
    const charged = await charge(merchant, { token, amount: "2" });

    expect(await refundCharge(merchant, charged.id)).toEqual({ id: charged.id, object: "credit_charge", amount: "2.000000", refunded: true, balance: "5.000000", currency: "USD" });
    await expect(refundCharge(merchant, charged.id)).rejects.toMatchObject({ status: 409, type: "invalid_state", message: "This charge was already refunded." });
    expect(await balanceOf(accountId)).toBe("5.000000");
  });

  it("gives a charge back only once when refunds arrive together", async () => {
    const merchant = await createMerchant();
    const { accountId, token } = await fundCredits(merchant, "5");
    const charged = await charge(merchant, { token, amount: "2" });

    const results = await Promise.allSettled(Array.from({ length: 4 }, () => refundCharge(merchant, charged.id)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await balanceOf(accountId)).toBe("5.000000");
  });

  it("does not find another business's charge", async () => {
    const owner = await createMerchant();
    const stranger = await createMerchant();
    const { accountId, token } = await fundCredits(owner, "5");
    const charged = await charge(owner, { token, amount: "2" });

    await expect(refundCharge(stranger, charged.id)).rejects.toMatchObject({ status: 404, type: "not_found", param: "id" });
    expect(await balanceOf(accountId)).toBe("3.000000");
  });

  it("does not give back credits that a top-up refund took back", async () => {
    const merchant = await createMerchant();
    const { accountId, invoiceId } = await fundCredits(merchant, "10");
    const refund = await createRefund(merchant, { invoice_id: invoiceId, amount: "4" });
    const takeBack = await getDb().creditUsage.findUniqueOrThrow({ where: { refundTransferId: refund.id } });

    await expect(refundCharge(merchant, takeBack.id)).rejects.toMatchObject({ status: 404, type: "not_found" });
    expect(await balanceOf(accountId)).toBe("6.000000");
  });
});

describe("top-up refunds", () => {
  it("take back the refunded share of the credits", async () => {
    const merchant = await createMerchant();
    const { accountId, invoiceId } = await fundCredits(merchant, "10");

    const first = await createRefund(merchant, { invoice_id: invoiceId, amount: "4" });
    expect(await balanceOf(accountId)).toBe("6.000000");
    const rest = await createRefund(merchant, { invoice_id: invoiceId });
    expect(rest.amount).toBe("6");
    expect(await balanceOf(accountId)).toBe("0.000000");

    const usage = await usageOf(accountId);
    expect(usage.map((row) => [row.amount.toFixed(6), row.refundTransferId, row.description])).toEqual([
      ["4.000000", first.id, `Refund of top-up ${invoiceId}`],
      ["6.000000", rest.id, `Refund of top-up ${invoiceId}`],
    ]);
  });

  it("refuse a refund whose credits were already spent, and leave no refund behind", async () => {
    const merchant = await createMerchant();
    const { accountId, token, invoiceId } = await fundCredits(merchant, "10");
    await charge(merchant, { token, amount: "8" });

    await expect(createRefund(merchant, { invoice_id: invoiceId })).rejects.toMatchObject({
      status: 409,
      type: "invalid_state",
      param: "amount",
      message: "This refund takes back 10.000000 USD of credits, but the agent has only 2.000000 USD left. Refund a smaller amount.",
    });
    expect(await getDb().transfer.count()).toBe(0);
    expect(await balanceOf(accountId)).toBe("2.000000");

    await createRefund(merchant, { invoice_id: invoiceId, amount: "2" });
    expect(await balanceOf(accountId)).toBe("0.000000");
  });

  it("never take back more than was credited when each share rounds up", async () => {
    const merchant = await createMerchant();
    const account = await createCreditAccount(merchant, { balance: "10" });
    /** 10 USD of credits for 3 USDC settled, so each 1 USDC refund is a third of the credits. */
    const invoice = await createInvoice(merchant, { status: "paid", amount: "10.00", amountOutBase: "3000000", creditAccountId: account.id, creditedAt: new Date() });
    const quote = await createQuote(invoice, { oneclickStatus: "SUCCESS", state: "final" });
    await getDb().invoice.update({ where: { id: invoice.id }, data: { paidQuoteId: quote.id } });

    for (let refund = 0; refund < 3; refund++) await createRefund(merchant, { invoice_id: invoice.id, amount: "1" });
    expect((await usageOf(account.id)).map((row) => row.amount.toFixed(6))).toEqual(["3.333334", "3.333333", "3.333333"]);
    expect(await balanceOf(account.id)).toBe("0.000000");
  });

  it("take nothing back for a refund of an extra payment", async () => {
    const merchant = await createMerchant();
    const { accountId, invoiceId } = await fundCredits(merchant, "10");
    const extra = await payInvoice({ id: invoiceId });

    await createRefund(merchant, { invoice_id: invoiceId, payment_id: extra.id });
    expect(await balanceOf(accountId)).toBe("10.000000");
    expect(await usageOf(accountId)).toEqual([]);
  });

  it("take back credits only once when two refunds of the same top-up race", async () => {
    const merchant = await createMerchant();
    const { accountId, invoiceId } = await fundCredits(merchant, "10");

    const results = await Promise.allSettled([createRefund(merchant, { invoice_id: invoiceId, amount: "6" }), createRefund(merchant, { invoice_id: invoiceId, amount: "6" })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { status: 409, message: "At most 4 USDC of this payment can still be refunded." } });
    expect(await balanceOf(accountId)).toBe("4.000000");
  });
});

describe("restoreTopUpCredits", () => {
  it("gives the credits back once when the refund is canceled, so a later refund can take them again", async () => {
    const merchant = await createMerchant();
    const { accountId, invoiceId } = await fundCredits(merchant, "10");
    const refund = await createRefund(merchant, { invoice_id: invoiceId, amount: "4" });

    expect((await cancelTransfer(refund.id, merchant.id)).status).toBe("canceled");
    expect(await balanceOf(accountId)).toBe("10.000000");
    expect((await getDb().creditUsage.findUniqueOrThrow({ where: { refundTransferId: refund.id } })).refundedAt).not.toBeNull();

    await getDb().$transaction((tx) => restoreTopUpCredits(tx, refund.id));
    expect(await balanceOf(accountId)).toBe("10.000000");

    await createRefund(merchant, { invoice_id: invoiceId, amount: "4" });
    expect(await balanceOf(accountId)).toBe("6.000000");
  });

  it("does nothing for a refund that took no credits back", async () => {
    const merchant = await createMerchant();
    const { accountId } = await fundCredits(merchant, "10");
    await getDb().$transaction((tx) => restoreTopUpCredits(tx, "ref_unknown"));
    expect(await balanceOf(accountId)).toBe("10.000000");
  });
});
