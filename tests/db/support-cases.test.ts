import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { findInvoiceId, openSupportCase } from "@/lib/support/cases";
import { createInvoice, createMerchant, createPaymentEvent, createQuote } from "./factories";

const HASH_A = `0x${"a1".repeat(32)}`;
const HASH_B = `0x${"b2".repeat(32)}`;

async function invoiceWithQuote() {
  const merchant = await createMerchant();
  const invoice = await createInvoice(merchant);
  const quote = await createQuote(invoice);
  return { merchant, invoice, quote };
}

const report = (overrides: Partial<Parameters<typeof openSupportCase>[0]> = {}) => ({ tx_hash: HASH_A, chain: "eth", kind: "stuck" as const, ...overrides });

describe("findInvoiceId", () => {
  it("finds the invoice and payment by a hash NEAR Intents saw", async () => {
    const { invoice, quote } = await invoiceWithQuote();
    await createPaymentEvent(quote, [HASH_A]);
    expect(await findInvoiceId({ tx_hash: HASH_A })).toEqual({ invoiceId: invoice.id, quoteId: quote.id, matchedBy: "tx_hash" });
  });

  it("finds an invoice by its id, with the payment the hash names", async () => {
    const { invoice, quote } = await invoiceWithQuote();
    await createQuote(invoice);
    await createPaymentEvent(quote, [HASH_A]);
    expect(await findInvoiceId({ invoice_id: invoice.id, tx_hash: HASH_A })).toEqual({ invoiceId: invoice.id, quoteId: quote.id, matchedBy: "invoice_id" });
    expect(await findInvoiceId({ invoice_id: invoice.id })).toEqual({ invoiceId: invoice.id, quoteId: undefined, matchedBy: "invoice_id" });
  });

  it("does not take a payment of another invoice for the named one", async () => {
    const mine = await invoiceWithQuote();
    const other = await invoiceWithQuote();
    await createPaymentEvent(other.quote, [HASH_A]);
    expect(await findInvoiceId({ invoice_id: mine.invoice.id, tx_hash: HASH_A })).toEqual({ invoiceId: mine.invoice.id, quoteId: undefined, matchedBy: "invoice_id" });
  });

  it("falls back to the hash when the invoice id is unknown", async () => {
    const { invoice, quote } = await invoiceWithQuote();
    await createPaymentEvent(quote, [HASH_A]);
    expect(await findInvoiceId({ invoice_id: "inv_missing", tx_hash: HASH_A })).toMatchObject({ invoiceId: invoice.id, matchedBy: "tx_hash" });
  });

  it("trusts a hash the customer reported only when one invoice claims it", async () => {
    const first = await invoiceWithQuote();
    await getDb().quote.update({ where: { id: first.quote.id }, data: { depositTxHash: HASH_A } });
    expect(await findInvoiceId({ tx_hash: HASH_A })).toEqual({ invoiceId: first.invoice.id, quoteId: first.quote.id, matchedBy: "tx_hash" });

    const second = await invoiceWithQuote();
    await getDb().quote.update({ where: { id: second.quote.id }, data: { depositTxHash: HASH_A } });
    expect(await findInvoiceId({ tx_hash: HASH_A })).toBeUndefined();
  });

  it("counts two reports of one hash on the same invoice as one claim", async () => {
    const { invoice, quote } = await invoiceWithQuote();
    await getDb().quote.update({ where: { id: quote.id }, data: { depositTxHash: HASH_A } });
    await createQuote(invoice, { depositTxHash: HASH_A });
    expect(await findInvoiceId({ tx_hash: HASH_A })).toMatchObject({ invoiceId: invoice.id, matchedBy: "tx_hash" });
  });

  it("prefers what NEAR Intents saw over a report on another invoice", async () => {
    const seen = await invoiceWithQuote();
    const reported = await invoiceWithQuote();
    await createPaymentEvent(seen.quote, [HASH_A]);
    await getDb().quote.update({ where: { id: reported.quote.id }, data: { depositTxHash: HASH_A } });
    expect(await findInvoiceId({ tx_hash: HASH_A })).toMatchObject({ invoiceId: seen.invoice.id });
  });

  it("finds nothing for an unknown hash", async () => {
    await invoiceWithQuote();
    expect(await findInvoiceId({ tx_hash: HASH_B })).toBeUndefined();
  });
});

describe("openSupportCase", () => {
  it("reports the payment address the reported hash went to, not the newest one", async () => {
    const merchant = await createMerchant();
    const invoice = await createInvoice(merchant);
    const paid = await createQuote(invoice, { depositTxHash: HASH_A, createdAt: new Date(Date.now() - 60_000) });
    await createQuote(invoice);

    const opened = await openSupportCase(report({ invoice_id: invoice.id }));
    expect(opened.report_text).toContain(`deposit address: ${paid.depositAddress}`);
    expect(opened.report_text).toContain(`correlation id: ${paid.correlationId}`);
    const stored = await getDb().supportCase.findUniqueOrThrow({ where: { id: opened.id } });
    expect(stored.quoteId).toBe(paid.id);
  });

  it("uses the newest payment address when the hash names none", async () => {
    const merchant = await createMerchant();
    const invoice = await createInvoice(merchant);
    await createQuote(invoice, { createdAt: new Date(Date.now() - 60_000) });
    const newest = await createQuote(invoice);
    const opened = await openSupportCase(report({ invoice_id: invoice.id, tx_hash: HASH_B }));
    expect(opened.report_text).toContain(`deposit address: ${newest.depositAddress}`);
  });

  it("files a payment sent on another network than its address as wrong_chain", async () => {
    const { invoice } = await invoiceWithQuote();
    expect((await openSupportCase(report({ invoice_id: invoice.id, chain: "base", kind: "stuck" }))).kind).toBe("wrong_chain");
    expect((await openSupportCase(report({ invoice_id: invoice.id, tx_hash: HASH_B, chain: "not-a-chain", kind: "stuck" }))).kind).toBe("stuck");
  });

  it("files a report that matches no invoice as not_found, without telling any business", async () => {
    const opened = await openSupportCase(report({ kind: "stuck" }));
    expect(opened.kind).toBe("not_found");
    expect(await getDb().alert.count()).toBe(0);
  });

  it("hides the invoice id from a report matched by hash alone, and shows it to someone who knew it", async () => {
    const { invoice, quote } = await invoiceWithQuote();
    await createPaymentEvent(quote, [HASH_A]);
    expect((await openSupportCase(report())).report_text).not.toContain(invoice.id);
    expect((await openSupportCase(report({ invoice_id: invoice.id, tx_hash: HASH_B }))).report_text).toContain(`invoice id: ${invoice.id}`);
  });

  it("returns the case still open for a repeated report, without another reporter's details", async () => {
    const { invoice } = await invoiceWithQuote();
    const first = await openSupportCase(report({ invoice_id: invoice.id, details: "my phone number is 555" }));
    const again = await openSupportCase(report({ invoice_id: invoice.id }));
    expect(again.id).toBe(first.id);
    expect(again.report_text).not.toContain("my phone number is 555");
    expect(await getDb().supportCase.count()).toBe(1);
  });

  it("tells the business with an alert and a support_case.created webhook", async () => {
    const merchant = await createMerchant({ webhookUrl: "https://shop.example/hook", webhookSecretEnc: "v1.a.b.c" });
    const invoice = await createInvoice(merchant);
    await createQuote(invoice);
    const opened = await openSupportCase(report({ invoice_id: invoice.id }));
    expect(await getDb().alert.findFirst({ where: { merchantId: merchant.id, kind: "support_case" } })).toMatchObject({ message: expect.stringContaining(opened.id) });
    expect(await getDb().webhookDelivery.findFirst({ where: { merchantId: merchant.id } })).toMatchObject({ eventType: "support_case.created" });
  });

  it("refuses a sixth case for one invoice within a day, with Retry-After until the oldest leaves the window", async () => {
    const { invoice } = await invoiceWithQuote();
    for (let index = 0; index < 5; index++) await openSupportCase(report({ invoice_id: invoice.id, tx_hash: `0x${String(index).repeat(64)}` }));
    const oldest = await getDb().supportCase.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    await getDb().supportCase.update({ where: { id: oldest.id }, data: { createdAt: new Date(Date.now() - 60 * 60_000) } });

    const refused = openSupportCase(report({ invoice_id: invoice.id, tx_hash: HASH_B }));
    await expect(refused).rejects.toMatchObject({ status: 429, type: "rate_limited" });
    const retryAfter = await refused.catch((error: { retryAfter: number }) => error.retryAfter);
    expect(retryAfter).toBeGreaterThan(23 * 60 * 60 - 5);
    expect(retryAfter).toBeLessThanOrEqual(23 * 60 * 60);
  });

  it("still returns an open case for a repeated report once the invoice reached its cap", async () => {
    const { invoice } = await invoiceWithQuote();
    for (let index = 0; index < 5; index++) await openSupportCase(report({ invoice_id: invoice.id, tx_hash: `0x${String(index).repeat(64)}` }));
    await expect(openSupportCase(report({ invoice_id: invoice.id, tx_hash: `0x${"0".repeat(64)}` }))).resolves.toMatchObject({ kind: "stuck" });
  });
});
