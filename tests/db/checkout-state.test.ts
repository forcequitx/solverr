import { describe, expect, it } from "vitest";
import { getCheckoutState } from "@/lib/payments/checkout-state";
import { createInvoice, createMerchant } from "./factories";

describe("public checkout state", () => {
  it("leaves out the business's own description but keeps the order reference the receipt shows", async () => {
    const invoice = await createInvoice(await createMerchant(), { description: "VIP: comp shipping", orderId: "order-1042" });
    const state = await getCheckoutState(invoice.id);
    expect(state).not.toBeNull();
    expect(state).not.toHaveProperty("description");
    expect(JSON.stringify(state)).not.toContain("VIP: comp shipping");
    expect(state).toMatchObject({ order_id: "order-1042" });
  });
});
