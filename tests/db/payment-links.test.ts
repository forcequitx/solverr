import { describe, expect, it, vi } from "vitest";
import { POST as payLinkRoute } from "@/app/api/v1/payment-links/[id]/invoices/route";
import { getDb } from "@/lib/db";
import { createPaymentLink } from "@/lib/payment-links/links";
import { createMerchant } from "./factories";

/** Invoices are priced from the token list, which stands in for 1Click here. */
vi.mock("@/lib/oneclick/tokens", async (importOriginal) => {
  const { TEST_TOKENS } = await import("./factories");
  return {
    ...(await importOriginal<typeof import("@/lib/oneclick/tokens")>()),
    findToken: async (assetId: string) => TEST_TOKENS.find((token) => token.assetId === assetId),
  };
});

/** A customer opening the link, as the payment link page sends it without a key. */
function pay(linkId: string, body: object = {}): Promise<Response> {
  const request = new Request(`http://localhost:3000/api/v1/payment-links/${linkId}/invoices`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return payLinkRoute(request, { params: Promise.resolve({ id: linkId }) });
}

/** A live link of a new business: fixed-price when `amount` is given, otherwise the customer chooses the amount. */
async function link(amount?: string) {
  return createPaymentLink(await createMerchant(), "live", { title: "Coffee beans", currency: "USD", ...(amount ? { amount } : {}) });
}

const createdInvoice = async (response: Response) => getDb().invoice.findUniqueOrThrow({ where: { id: (await response.json()).id } });

describe("POST /api/v1/payment-links/:id/invoices", () => {
  it("charges a fixed-price link's own amount, whatever amount the customer sends", async () => {
    const fixed = await link("100.00");

    const response = await pay(fixed.id, { amount: "0.01" });
    expect(response.status).toBe(201);
    const invoice = await createdInvoice(response);
    expect(invoice.amount.toFixed(2)).toBe("100.00");
    expect(invoice).toMatchObject({ amountOutBase: "100000000", paymentLinkId: fixed.id, mode: "live", description: "Coffee beans" });
  });

  it("charges the amount the customer chose on a tip link", async () => {
    const tip = await link();

    const response = await pay(tip.id, { amount: "12.34" });
    expect(response.status).toBe(201);
    const invoice = await createdInvoice(response);
    expect(invoice.amount.toFixed(2)).toBe("12.34");
    expect(invoice).toMatchObject({ amountOutBase: "12340000", paymentLinkId: tip.id });
  });

  it("refuses a tip link without an amount or with an invalid one and creates no invoice", async () => {
    const tip = await link();

    const missing = await pay(tip.id);
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: { type: "invalid_request", message: "Enter the amount you want to pay.", param: "amount" } });
    for (const amount of ["abc", "0", "1.005", "-5"]) {
      const invalid = await pay(tip.id, { amount });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ error: { type: "invalid_request", param: "amount" } });
    }
    expect(await getDb().invoice.count()).toBe(0);
  });

  it("answers 404 for a turned-off link and creates no invoice", async () => {
    const fixed = await link("100.00");
    await getDb().paymentLink.update({ where: { id: fixed.id }, data: { active: false } });

    const response = await pay(fixed.id);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { type: "not_found" } });
    expect(await getDb().invoice.count()).toBe(0);
  });
});
