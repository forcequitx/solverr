import { afterEach, describe, expect, it, vi } from "vitest";
import type { Solverr } from "../src/index.js";
import { attempt, client, json, mockFetch } from "./fetch-mock.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Case {
  name: string;
  call: (solverr: Solverr) => Promise<unknown>;
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: unknown;
}

const LIST_PAGE = { object: "list", data: [], has_more: false };

const cases: Case[] = [
  { name: "invoices.create", call: (s) => s.invoices.create({ amount: "25.00", currency: "USD", order_id: "o1" }), method: "POST", path: "/api/v1/invoices", body: { amount: "25.00", currency: "USD", order_id: "o1" } },
  { name: "invoices.retrieve", call: (s) => s.invoices.retrieve("inv_1"), method: "GET", path: "/api/v1/invoices/inv_1" },
  { name: "invoices.list", call: (s) => s.invoices.list({ limit: 10, status: "paid", starting_after: "inv_9" }), method: "GET", path: "/api/v1/invoices?limit=10&status=paid&starting_after=inv_9" },
  { name: "invoices.redeem", call: (s) => s.invoices.redeem("inv_1"), method: "POST", path: "/api/v1/invoices/inv_1/redeem" },
  { name: "paymentLinks.create", call: (s) => s.paymentLinks.create({ title: "Tea", currency: "EUR" }), method: "POST", path: "/api/v1/payment-links", body: { title: "Tea", currency: "EUR" } },
  { name: "paymentLinks.list", call: (s) => s.paymentLinks.list({ limit: 3 }), method: "GET", path: "/api/v1/payment-links?limit=3" },
  { name: "paymentLinks.deactivate", call: (s) => s.paymentLinks.deactivate("lnk_1"), method: "DELETE", path: "/api/v1/payment-links/lnk_1" },
  { name: "refunds.create", call: (s) => s.refunds.create({ invoice_id: "inv_1", amount: "2" }), method: "POST", path: "/api/v1/refunds", body: { invoice_id: "inv_1", amount: "2" } },
  { name: "refunds.retrieve", call: (s) => s.refunds.retrieve("rf_1"), method: "GET", path: "/api/v1/refunds/rf_1" },
  { name: "refunds.list", call: (s) => s.refunds.list(), method: "GET", path: "/api/v1/refunds" },
  { name: "refunds.cancel", call: (s) => s.refunds.cancel("rf_1"), method: "POST", path: "/api/v1/refunds/rf_1/cancel", body: {} },
  { name: "payouts.create", call: (s) => s.payouts.create({ recipient: "bob.near", asset_id: "nep141:usdc", amount: "3" }), method: "POST", path: "/api/v1/payouts", body: { recipient: "bob.near", asset_id: "nep141:usdc", amount: "3" } },
  {
    name: "payouts.createBatch",
    call: (s) => s.payouts.createBatch({ payouts: [{ recipient: "a.near", asset_id: "nep141:usdc", amount: "1" }] }),
    method: "POST",
    path: "/api/v1/payouts/batch",
    body: { payouts: [{ recipient: "a.near", asset_id: "nep141:usdc", amount: "1" }] },
  },
  { name: "payouts.retrieve", call: (s) => s.payouts.retrieve("po_1"), method: "GET", path: "/api/v1/payouts/po_1" },
  { name: "payouts.list", call: (s) => s.payouts.list({ starting_after: "po_2" }), method: "GET", path: "/api/v1/payouts?starting_after=po_2" },
  { name: "payouts.cancel", call: (s) => s.payouts.cancel("po_1"), method: "POST", path: "/api/v1/payouts/po_1/cancel", body: {} },
  {
    name: "subscriptions.create",
    call: (s) => s.subscriptions.create({ customer_email: "a@b.co", amount: "9", currency: "USD", interval: "month" }),
    method: "POST",
    path: "/api/v1/subscriptions",
    body: { customer_email: "a@b.co", amount: "9", currency: "USD", interval: "month" },
  },
  { name: "subscriptions.list", call: (s) => s.subscriptions.list(), method: "GET", path: "/api/v1/subscriptions" },
  { name: "subscriptions.cancel", call: (s) => s.subscriptions.cancel("sub_1"), method: "DELETE", path: "/api/v1/subscriptions/sub_1" },
  { name: "credits.topup", call: (s) => s.credits.topup({ amount: "20", currency: "USD" }), method: "POST", path: "/api/v1/credits/topup", body: { amount: "20", currency: "USD" } },
  { name: "credits.charge", call: (s) => s.credits.charge({ token: "ct_1", amount: "0.1" }), method: "POST", path: "/api/v1/credits/charge", body: { token: "ct_1", amount: "0.1" } },
  { name: "credits.refundCharge", call: (s) => s.credits.refundCharge("ch_1"), method: "POST", path: "/api/v1/credits/charges/ch_1/refund", body: {} },
  { name: "tokens.list", call: (s) => s.tokens.list(), method: "GET", path: "/api/v1/tokens" },
  { name: "webhooks.sendTest", call: (s) => s.webhooks.sendTest(), method: "POST", path: "/api/v1/webhooks/test" },
];

describe("resource methods", () => {
  it.each(cases)("$name sends $method $path", async ({ call, method, path, body }) => {
    const { calls } = mockFetch(json(LIST_PAGE));
    await call(client());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe(method);
    expect(calls[0]?.url).toBe(`https://pay.example.com${path}`);
    expect(calls[0]?.body === undefined ? undefined : JSON.parse(calls[0].body)).toEqual(body);
    if (method === "POST") expect(calls[0]?.headers["idempotency-key"]).toBeTruthy();
    else expect(calls[0]?.headers["idempotency-key"]).toBeUndefined();
  });

  it.each([
    ["refunds.cancel", (s: Solverr) => s.refunds.cancel("rf_1", { idempotencyKey: "k1" })],
    ["payouts.cancel", (s: Solverr) => s.payouts.cancel("po_1", { idempotencyKey: "k1" })],
    ["credits.charge", (s: Solverr) => s.credits.charge({ token: "t", amount: "1" }, { idempotencyKey: "k1" })],
    ["invoices.redeem", (s: Solverr) => s.invoices.redeem("inv_1", { idempotencyKey: "k1" })],
  ])("%s passes the caller's Idempotency-Key", async (_name, call) => {
    const { calls } = mockFetch(json({}));
    await call(client());
    expect(calls[0]?.headers["idempotency-key"]).toBe("k1");
  });

  it.each([
    ["invoices.retrieve", (s: Solverr) => s.invoices.retrieve("..")],
    ["invoices.redeem", (s: Solverr) => s.invoices.redeem(".")],
    ["paymentLinks.deactivate", (s: Solverr) => s.paymentLinks.deactivate("")],
    ["payouts.cancel", (s: Solverr) => s.payouts.cancel("..")],
    ["subscriptions.cancel", (s: Solverr) => s.subscriptions.cancel("..")],
    ["credits.refundCharge", (s: Solverr) => s.credits.refundCharge("..")],
  ])("%s refuses an id that would change the path", async (_name, call) => {
    const { fetchStub } = mockFetch(json({}));
    await expect(attempt<unknown>(() => call(client()))).rejects.toThrow(TypeError);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe("invoices.listAll", () => {
  it("follows has_more with the last id of each page", async () => {
    const { calls } = mockFetch(
      json({ object: "list", data: [{ id: "inv_3" }, { id: "inv_2" }], has_more: true }),
      json({ object: "list", data: [{ id: "inv_1" }], has_more: false }),
    );
    const ids: string[] = [];
    for await (const invoice of client().invoices.listAll({ status: "paid", limit: 2 })) ids.push(invoice.id);
    expect(ids).toEqual(["inv_3", "inv_2", "inv_1"]);
    expect(calls.map((call) => call.url)).toEqual([
      "https://pay.example.com/api/v1/invoices?status=paid&limit=2",
      "https://pay.example.com/api/v1/invoices?status=paid&limit=2&starting_after=inv_2",
    ]);
  });

  it("stops on an empty page even when has_more is true", async () => {
    const { calls } = mockFetch(json({ object: "list", data: [], has_more: true }));
    const ids: string[] = [];
    for await (const invoice of client().invoices.listAll()) ids.push(invoice.id);
    expect(ids).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});
