import { describe, expect, it } from "vitest";
import type { Mode } from "@/generated/prisma/client";
import { POST as simulateRoute } from "@/app/api/v1/invoices/[id]/simulate/route";
import { getDb } from "@/lib/db";
import { createInvoice, createMerchant, createQuote } from "./factories";

/** The Simulate panel's request, sent without a key as the public checkout sends it. */
function simulate(invoiceId: string, outcome = "paid"): Promise<Response> {
  const request = new Request(`http://localhost:3000/api/v1/invoices/${invoiceId}/simulate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ outcome }),
  });
  return simulateRoute(request, { params: Promise.resolve({ id: invoiceId }) });
}

/** An open invoice in `mode` with a payment address waiting for the deposit. */
async function invoiceWithAddress(mode: Mode) {
  const invoice = await createInvoice(await createMerchant(), { mode });
  const quote = await createQuote(invoice);
  return { invoice, quote };
}

const reload = async (invoiceId: string, quoteId: string) => ({
  invoice: await getDb().invoice.findUniqueOrThrow({ where: { id: invoiceId } }),
  quote: await getDb().quote.findUniqueOrThrow({ where: { id: quoteId } }),
});

describe("POST /api/v1/invoices/:id/simulate", () => {
  it("answers a live invoice as if it did not exist and leaves its payment untouched", async () => {
    const { invoice, quote } = await invoiceWithAddress("live");

    const response = await simulate(invoice.id);
    expect(response.status).toBe(404);
    const unknown = await simulate("inv_doesnotexist");
    expect(await response.json()).toEqual(await unknown.json());

    const after = await reload(invoice.id, quote.id);
    expect(after.quote).toMatchObject({ simulatedOutcome: null, simulatedAt: null, oneclickStatus: "PENDING_DEPOSIT" });
    expect(after.invoice.status).toBe("awaiting_payment");
    expect(await getDb().paymentEvent.count()).toBe(0);
  });

  it("starts the chosen outcome on a demo store (test mode) invoice and applies its first step at once", async () => {
    const { invoice, quote } = await invoiceWithAddress("test");

    const response = await simulate(invoice.id);
    expect(response.status).toBe(204);

    const after = await reload(invoice.id, quote.id);
    expect(after.quote).toMatchObject({ simulatedOutcome: "paid", oneclickStatus: "KNOWN_DEPOSIT_TX" });
    expect(after.quote.simulatedAt).not.toBeNull();
    expect(after.invoice.status).toBe("detected");
    expect(await getDb().paymentEvent.count({ where: { quoteId: quote.id, oneclickStatus: "KNOWN_DEPOSIT_TX" } })).toBe(1);
  });
});
