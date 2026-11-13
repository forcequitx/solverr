import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { retireMerchantOpenQuotes } from "@/lib/payments/quote";
import { createInvoice, createMerchant, createQuote } from "./factories";

/** Collects `checkout` notifications from a separate connection while `run` commits. */
async function notificationsDuring(run: () => Promise<void>): Promise<string[]> {
  const listener = new Client({ connectionString: process.env.DATABASE_URL });
  const received: string[] = [];
  await listener.connect();
  try {
    listener.on("notification", ({ payload }) => payload && received.push(payload));
    await listener.query("LISTEN checkout");
    await run();
    await listener.query("SELECT 1");
    return received;
  } finally {
    await listener.end();
  }
}

describe("retireMerchantOpenQuotes", () => {
  it("retires every open address of the business in one pass and refreshes each of its checkouts once", async () => {
    const merchant = await createMerchant();
    const other = await createMerchant();
    const invoices = await Promise.all([createInvoice(merchant), createInvoice(merchant), createInvoice(merchant)]);
    const open = await Promise.all(invoices.map((invoice) => createQuote(invoice)));
    const second = await createQuote(invoices[0]);
    const moving = await createQuote(invoices[1], { oneclickStatus: "PROCESSING" });
    const othersQuote = await createQuote(await createInvoice(other));

    const notified = await notificationsDuring(() => getDb().$transaction((tx) => retireMerchantOpenQuotes(tx, merchant.id)));

    const states = await getDb().quote.findMany({ where: { id: { in: [...open, second, moving, othersQuote].map((q) => q.id) } } });
    const stateOf = (id: string) => states.find((quote) => quote.id === id)?.state;
    for (const quote of [...open, second]) expect(stateOf(quote.id)).toBe("retired");
    expect(stateOf(moving.id)).toBe("active");
    expect(stateOf(othersQuote.id)).toBe("active");
    expect(states.find((quote) => quote.id === second.id)?.watchUntil?.getTime()).toBeGreaterThan(Date.now());
    expect(notified.sort()).toEqual(invoices.map((invoice) => invoice.id).sort());
  });

  it("does nothing when the business has no open address", async () => {
    const merchant = await createMerchant();
    const notified = await notificationsDuring(() => getDb().$transaction((tx) => retireMerchantOpenQuotes(tx, merchant.id)));
    expect(notified).toEqual([]);
  });
});
