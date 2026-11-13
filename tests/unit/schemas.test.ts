import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { parseInput } from "@/lib/api/errors";
import { createInvoiceSchema } from "@/lib/invoices/schema";
import { createPaymentLinkSchema, payLinkSchema } from "@/lib/payment-links/links";
import { reportDepositSchema } from "@/lib/payments/deposit";
import { createQuoteSchema } from "@/lib/payments/quote";
import { createCaseSchema, lookupSchema } from "@/lib/support/cases";
import { createPayoutSchema, createRefundSchema } from "@/lib/transfers/transfers";

/** The 400 error the API answers with for `body`: its message and the field it names. */
function refusal(schema: ZodType, body: unknown): { message: string; param?: string } {
  try {
    parseInput(schema, body);
  } catch (error) {
    const { message, param, status } = error as { message: string; param?: string; status: number };
    expect(status).toBe(400);
    return { message, param };
  }
  throw new Error("The body was accepted");
}

describe("POST /invoices body", () => {
  it("accepts a minimal and a full invoice", () => {
    expect(createInvoiceSchema.parse({ amount: "25.00", currency: "USD" })).toEqual({ amount: "25.00", currency: "USD" });
    const full = {
      amount: "1999.5",
      currency: "EUR",
      order_id: "order-42",
      description: "House beans, 1 kg",
      redirect_url: "https://shop.example/thanks",
      customer_email: "buyer@example.com",
      metadata: { cart: "c_1", channel: "web" },
      expires_in: 900,
    };
    expect(createInvoiceSchema.parse(full)).toEqual(full);
  });

  it("explains a missing amount and an amount sent as a number", () => {
    expect(refusal(createInvoiceSchema, { currency: "USD" })).toEqual({ message: 'amount is required, as a decimal string such as "25.00".', param: "amount" });
    expect(refusal(createInvoiceSchema, { amount: 25, currency: "USD" }).message).toMatch(/^amount must be a decimal string/);
  });

  it.each(["25.001", "1,000", "-5", "1e3", "1000000000000"])("refuses the amount %s", (amount) => {
    expect(refusal(createInvoiceSchema, { amount, currency: "USD" }).param).toBe("amount");
  });

  it("refuses a zero amount", () => {
    expect(refusal(createInvoiceSchema, { amount: "0.00", currency: "USD" })).toEqual({ message: "amount must be greater than 0.", param: "amount" });
  });

  it("refuses an unsupported currency and unknown fields", () => {
    expect(refusal(createInvoiceSchema, { amount: "1", currency: "GBP" })).toEqual({ message: "currency must be USD, EUR or INR.", param: "currency" });
    expect(refusal(createInvoiceSchema, { amount: "1", currency: "USD", amount_cents: 100 }).param).toBe("amount_cents");
  });

  it.each(["javascript:alert(1)", "ftp://shop.example/file", "data:text/html,hi", "not a url"])("refuses the redirect_url %s", (redirect_url) => {
    expect(refusal(createInvoiceSchema, { amount: "1", currency: "USD", redirect_url })).toEqual({ message: "redirect_url must be an http or https URL.", param: "redirect_url" });
  });

  it("refuses a redirect_url over 2048 characters", () => {
    const redirect_url = `https://shop.example/${"a".repeat(2048)}`;
    expect(refusal(createInvoiceSchema, { amount: "1", currency: "USD", redirect_url }).message).toBe("redirect_url can be at most 2048 characters.");
  });

  it("limits metadata to 20 string values with short keys", () => {
    const tooMany = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`k${index}`, "v"]));
    expect(refusal(createInvoiceSchema, { amount: "1", currency: "USD", metadata: tooMany }).message).toBe("metadata can have at most 20 keys.");
    expect(refusal(createInvoiceSchema, { amount: "1", currency: "USD", metadata: { ["k".repeat(41)]: "v" } }).message).toBe("metadata keys can be at most 40 characters.");
    expect(refusal(createInvoiceSchema, { amount: "1", currency: "USD", metadata: { count: 3 } }).message).toBe("metadata values must be strings.");
    expect(refusal(createInvoiceSchema, { amount: "1", currency: "USD", metadata: { note: "x".repeat(501) } }).message).toBe("metadata values can be at most 500 characters.");
  });

  it("keeps expires_in between 15 minutes and 24 hours, in whole seconds", () => {
    expect(refusal(createInvoiceSchema, { amount: "1", currency: "USD", expires_in: 899 }).message).toBe("expires_in must be at least 900 seconds (15 minutes).");
    expect(refusal(createInvoiceSchema, { amount: "1", currency: "USD", expires_in: 86_401 }).message).toBe("expires_in must be at most 86400 seconds (24 hours).");
    expect(refusal(createInvoiceSchema, { amount: "1", currency: "USD", expires_in: 900.5 }).param).toBe("expires_in");
    expect(createInvoiceSchema.parse({ amount: "1", currency: "USD", expires_in: 86_400 }).expires_in).toBe(86_400);
  });

  it("refuses an invalid customer email", () => {
    expect(refusal(createInvoiceSchema, { amount: "1", currency: "USD", customer_email: "buyer@" })).toEqual({
      message: "customer_email must be a valid email address.",
      param: "customer_email",
    });
  });
});

describe("payment link bodies", () => {
  it("accepts a fixed-amount link and a tip link, trimming the title", () => {
    expect(createPaymentLinkSchema.parse({ title: "  Coffee  ", amount: "4.50", currency: "USD" })).toEqual({ title: "Coffee", amount: "4.50", currency: "USD" });
    expect(createPaymentLinkSchema.parse({ title: "Tips", currency: "INR" })).toEqual({ title: "Tips", currency: "INR" });
  });

  it("requires a title of at most 120 characters", () => {
    expect(refusal(createPaymentLinkSchema, { currency: "USD" })).toEqual({ message: "title is required.", param: "title" });
    expect(refusal(createPaymentLinkSchema, { title: "   ", currency: "USD" })).toEqual({ message: "title is required.", param: "title" });
    expect(refusal(createPaymentLinkSchema, { title: "t".repeat(121), currency: "USD" }).message).toBe("title can be at most 120 characters.");
  });

  it("checks a customer-chosen amount like an invoice amount", () => {
    expect(payLinkSchema.parse({})).toEqual({});
    expect(payLinkSchema.parse({ amount: "12.5" })).toEqual({ amount: "12.5" });
    expect(refusal(payLinkSchema, { amount: "0" }).message).toBe("amount must be greater than 0.");
    expect(refusal(payLinkSchema, { amount: "1", tip: true }).param).toBe("tip");
  });
});

describe("checkout bodies", () => {
  it("requires a coin and a refund address for a payment address, trimming the address", () => {
    expect(createQuoteSchema.parse({ origin_asset: "nep141:eth.omft.near", refund_address: " 0xabc " })).toEqual({ origin_asset: "nep141:eth.omft.near", refund_address: "0xabc" });
    expect(refusal(createQuoteSchema, { origin_asset: "nep141:eth.omft.near" })).toEqual({ message: "refund_address is required.", param: "refund_address" });
  });

  it("accepts transaction hashes of every chain and refuses other text", () => {
    for (const tx_hash of [`0x${"ab".repeat(32)}`, "5".repeat(88), "9".repeat(44), "abc:def_ghi-jkl.mno"]) {
      expect(reportDepositSchema.parse({ tx_hash })).toEqual({ tx_hash });
    }
    expect(refusal(reportDepositSchema, { tx_hash: "0x1234" }).message).toBe("tx_hash looks too short.");
    expect(refusal(reportDepositSchema, { tx_hash: "0x1234567890<script>" }).message).toBe("tx_hash contains characters a transaction hash cannot have.");
    expect(refusal(reportDepositSchema, {})).toEqual({ message: "Send tx_hash, or wallet_sent: true when the wallet returned no transaction hash.", param: "tx_hash" });
  });

  it("accepts wallet_sent from a wallet that returns no hash, but not together with a hash", () => {
    expect(reportDepositSchema.parse({ wallet_sent: true, payment_id: "quo_1" })).toEqual({ wallet_sent: true, payment_id: "quo_1" });
    expect(refusal(reportDepositSchema, { wallet_sent: true, tx_hash: `0x${"ab".repeat(32)}` }).param).toBe("tx_hash");
  });
});

describe("support case bodies", () => {
  const base = { tx_hash: `0x${"ab".repeat(32)}`, chain: "base", kind: "stuck" };

  it("accepts a case with or without an invoice id", () => {
    expect(createCaseSchema.parse(base)).toEqual(base);
    expect(createCaseSchema.parse({ ...base, invoice_id: "inv_1", details: "Sent 25 USDC" })).toMatchObject({ invoice_id: "inv_1" });
  });

  it("refuses a malformed network id, an unknown problem and long details", () => {
    expect(refusal(createCaseSchema, { ...base, chain: "Base Mainnet" })).toEqual({ message: "chain must be a network id such as base or near.", param: "chain" });
    expect(refusal(createCaseSchema, { ...base, kind: "swap_failed" }).param).toBe("kind");
    expect(refusal(createCaseSchema, { ...base, details: "x".repeat(1001) }).param).toBe("details");
  });

  it("looks a payment up by invoice id or transaction hash, at least one of them", () => {
    expect(lookupSchema.parse({ invoice_id: "inv_1" })).toEqual({ invoice_id: "inv_1" });
    expect(lookupSchema.parse({ tx_hash: base.tx_hash })).toEqual({ tx_hash: base.tx_hash });
    expect(refusal(lookupSchema, {}).message).toBe("Enter the payment ID or your transaction hash.");
  });
});

describe("transfer bodies", () => {
  it("accepts refund and payout amounts with up to 18 decimals", () => {
    expect(createRefundSchema.parse({ invoice_id: "inv_1" })).toEqual({ invoice_id: "inv_1" });
    expect(createRefundSchema.parse({ invoice_id: "inv_1", amount: "0.000000000000000001" })).toMatchObject({ amount: "0.000000000000000001" });
    expect(createPayoutSchema.parse({ recipient: " alice.near ", asset_id: "nep141:wrap.near", amount: "10" })).toEqual({ recipient: "alice.near", asset_id: "nep141:wrap.near", amount: "10" });
  });

  it("refuses zero, too many decimals and missing fields", () => {
    expect(refusal(createPayoutSchema, { recipient: "alice.near", asset_id: "nep141:wrap.near", amount: "0" }).message).toBe("amount must be greater than 0.");
    expect(refusal(createRefundSchema, { invoice_id: "inv_1", amount: `0.${"1".repeat(19)}` }).param).toBe("amount");
    expect(refusal(createRefundSchema, {})).toEqual({ message: "invoice_id is required.", param: "invoice_id" });
  });
});
