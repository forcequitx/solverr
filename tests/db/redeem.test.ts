import { describe, expect, it } from "vitest";
import type { Invoice, InvoiceStatus, Merchant } from "@/generated/prisma/client";
import { POST as redeemRoute } from "@/app/api/v1/invoices/[id]/redeem/route";
import { createApiKey } from "@/lib/api/keys";
import { getDb } from "@/lib/db";
import { createInvoice, createMerchant, createPaymentEvent, createQuote } from "./factories";

const DEPOSIT_TX = `0x${"ab".repeat(32)}`;

/** A redeem request as the x402 paywall sends it; `secret` null sends no Authorization header. */
function redeem(invoiceId: string, secret: string | null, idempotencyKey?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (secret) headers.authorization = `Bearer ${secret}`;
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const request = new Request(`http://localhost:3000/api/v1/invoices/${invoiceId}/redeem`, { method: "POST", headers });
  return redeemRoute(request, { params: Promise.resolve({ id: invoiceId }) });
}

const redeemedAt = async (invoiceId: string) => (await getDb().invoice.findUniqueOrThrow({ where: { id: invoiceId } })).redeemedAt;

/** A business with a live API key and an invoice in `status`; a paid one has its completed payment and deposit event. */
async function businessWithInvoice(status: InvoiceStatus = "paid"): Promise<{ merchant: Merchant; secret: string; invoice: Invoice; quoteId: string }> {
  const merchant = await createMerchant();
  const { secret } = await createApiKey(merchant.id);
  const invoice = await createInvoice(merchant, { status });
  const quote = await createQuote(invoice, status === "paid" ? { oneclickStatus: "SUCCESS", state: "final" } : {});
  if (status === "paid") {
    await createPaymentEvent(quote, [DEPOSIT_TX], { oneclickStatus: "SUCCESS", depositedAmount: quote.amountIn });
    await getDb().invoice.update({ where: { id: invoice.id }, data: { paidQuoteId: quote.id, paidAt: new Date() } });
  }
  return { merchant, secret, invoice, quoteId: quote.id };
}

describe("POST /api/v1/invoices/:id/redeem", () => {
  it("redeems a paid invoice and returns the payment that paid it", async () => {
    const { secret, invoice, quoteId } = await businessWithInvoice();
    const response = await redeem(invoice.id, secret);

    expect(response.status).toBe(200);
    const body = await response.json();
    const stored = await redeemedAt(invoice.id);
    expect(stored).not.toBeNull();
    expect(body).toMatchObject({
      id: invoice.id,
      redeemed_at: stored!.toISOString(),
      payment: { id: quoteId, object: "payment", status: "success", deposited_amount: "0.01", origin_transactions: [{ hash: DEPOSIT_TX, url: `https://etherscan.io/tx/${DEPOSIT_TX}` }] },
    });
  });

  it("refuses a second redeem with 409 already_redeemed and keeps the first time", async () => {
    const { secret, invoice } = await businessWithInvoice();
    expect((await redeem(invoice.id, secret)).status).toBe(200);
    const first = await redeemedAt(invoice.id);

    const again = await redeem(invoice.id, secret);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: { type: "already_redeemed", message: "This payment was already used." } });
    expect(await redeemedAt(invoice.id)).toEqual(first);
  });

  it("lets only one of many simultaneous redeems through", async () => {
    const { secret, invoice } = await businessWithInvoice();
    const responses = await Promise.all(Array.from({ length: 5 }, () => redeem(invoice.id, secret)));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409, 409, 409, 409]);
    for (const response of responses.filter((entry) => entry.status === 409)) expect((await response.json()).error.type).toBe("already_redeemed");
  });

  it("replays the stored answer for a retry with the same Idempotency-Key", async () => {
    const { secret, invoice } = await businessWithInvoice();
    const first = await redeem(invoice.id, secret, "redeem-1");
    const retry = await redeem(invoice.id, secret, "redeem-1");
    expect(retry.status).toBe(200);
    expect(retry.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await retry.json()).toEqual(await first.json());
  });

  it.each<InvoiceStatus>(["awaiting_payment", "detected", "processing", "refunded", "expired"])("refuses a %s invoice with 409 invalid_state", async (status) => {
    const { secret, invoice } = await businessWithInvoice(status);
    const response = await redeem(invoice.id, secret);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { type: "invalid_state", message: "This invoice is not paid yet." } });
    expect(await redeemedAt(invoice.id)).toBeNull();
  });

  it("does not find another business's invoice", async () => {
    const { invoice } = await businessWithInvoice();
    const { secret: strangerSecret } = await createApiKey((await createMerchant()).id);
    const response = await redeem(invoice.id, strangerSecret);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { type: "not_found", message: "No invoice with this id.", param: "id" } });
    expect(await redeemedAt(invoice.id)).toBeNull();
  });

  it("needs a valid live API key", async () => {
    const { invoice } = await businessWithInvoice();
    const response = await redeem(invoice.id, null);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { type: "authentication_failed" } });
    expect(await redeemedAt(invoice.id)).toBeNull();
  });
});
