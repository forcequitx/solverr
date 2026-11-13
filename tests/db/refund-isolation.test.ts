import { describe, expect, it } from "vitest";
import type { Invoice, Merchant, Mode } from "@/generated/prisma/client";
import { POST as mcpRoute } from "@/app/api/mcp/route";
import { createApiKey } from "@/lib/api/keys";
import { getDb } from "@/lib/db";
import { lockInvoice } from "@/lib/row-locks";
import { createRefund } from "@/lib/transfers/transfers";
import { createInvoice, createMerchant, createQuote } from "./factories";

/** A 25 USDC invoice in `mode`, paid by one completed payment. */
async function paidInvoice(merchant: Merchant, mode: Mode = "live"): Promise<Invoice> {
  const invoice = await createInvoice(merchant, { status: "paid", mode });
  const quote = await createQuote(invoice, { oneclickStatus: "SUCCESS", state: "final" });
  return getDb().invoice.update({ where: { id: invoice.id }, data: { paidQuoteId: quote.id, paidAt: new Date() } });
}

/** Calls one MCP tool through the remote MCP endpoint with `secret` as the bearer token; returns the tool result. */
async function callTool(secret: string, name: string, args: object): Promise<{ isError?: boolean; content: { type: string; text: string }[] }> {
  const request = new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const response = await mcpRoute(request);
  expect(response.status).toBe(200);
  const text = await response.text();
  /** A streamed answer carries the JSON-RPC message on its `data:` line. */
  const message = response.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").find((line) => line.startsWith("data:"))!.slice(5) : text;
  return JSON.parse(message).result;
}

const transferCount = () => getDb().transfer.count();

describe("createRefund isolation", () => {
  it("does not find another business's paid invoice and creates no transfer", async () => {
    const owner = await createMerchant();
    const stranger = await createMerchant({ name: "Other Shop" });
    const invoice = await paidInvoice(owner);

    await expect(createRefund(stranger, { invoice_id: invoice.id })).rejects.toMatchObject({ status: 404, type: "not_found", param: "invoice_id" });
    expect(await transferCount()).toBe(0);
    expect((await createRefund(owner, { invoice_id: invoice.id })).merchantId).toBe(owner.id);
  });

  it("answers at once for another business's invoice instead of waiting on that business's lock", async () => {
    const owner = await createMerchant();
    const stranger = await createMerchant({ name: "Other Shop" });
    const invoice = await paidInvoice(owner);

    /** The owner's checkout or worker holds the invoice; a stranger's refund naming it must not queue behind it. */
    await getDb().$transaction(
      async (tx) => {
        await lockInvoice(tx, invoice.id);
        const started = Date.now();
        await expect(createRefund(stranger, { invoice_id: invoice.id })).rejects.toMatchObject({ status: 404, type: "not_found" });
        expect(Date.now() - started).toBeLessThan(3_000);
      },
      { timeout: 20_000 },
    );
  });

  it("does not refund a paid demo store (test mode) invoice and creates no transfer", async () => {
    const merchant = await createMerchant();
    const invoice = await paidInvoice(merchant, "test");

    await expect(createRefund(merchant, { invoice_id: invoice.id })).rejects.toMatchObject({ status: 404, type: "not_found" });
    expect(await transferCount()).toBe(0);
  });
});

describe("MCP create_refund isolation", () => {
  it("answers not found for another business's invoice and creates no transfer", async () => {
    const owner = await createMerchant();
    const stranger = await createMerchant({ name: "Other Shop" });
    const invoice = await paidInvoice(owner);
    const { secret: strangerSecret } = await createApiKey(stranger.id);
    const { secret: ownerSecret } = await createApiKey(owner.id);

    const refused = await callTool(strangerSecret, "create_refund", { invoice_id: invoice.id });
    expect(refused.isError).toBe(true);
    expect(JSON.parse(refused.content[0].text)).toEqual({ error: { type: "not_found", message: "No invoice with this id." } });
    expect(await transferCount()).toBe(0);

    const allowed = await callTool(ownerSecret, "create_refund", { invoice_id: invoice.id });
    expect(allowed.isError).toBeFalsy();
    expect(JSON.parse(allowed.content[0].text)).toMatchObject({ object: "refund", invoice_id: invoice.id, amount: "25" });
    expect(await transferCount()).toBe(1);
  });
});
