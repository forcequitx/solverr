import { describe, expect, it } from "vitest";
import type { OneClickStatus } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import type { StatusResponse } from "@/lib/oneclick/types";
import { applyStatus } from "@/lib/payments/apply-status";
import { lockInvoice } from "@/lib/row-locks";
import { createInvoice, createMerchant, createQuote } from "./factories";

const DEPOSIT_TX = `0x${"de".repeat(32)}`;

function status(value: OneClickStatus, updatedAt = new Date()): StatusResponse {
  return {
    correlationId: "corr-1",
    status: value,
    updatedAt: updatedAt.toISOString(),
    swapDetails: {
      intentHashes: [],
      nearTxHashes: [],
      originChainTxHashes: value === "PENDING_DEPOSIT" ? [] : [{ hash: DEPOSIT_TX, explorerUrl: "" }],
      destinationChainTxHashes: [],
      depositedAmount: value === "PENDING_DEPOSIT" ? undefined : "10000000000000000",
    },
  };
}

async function openPayment() {
  const merchant = await createMerchant({ webhookUrl: "https://shop.example/hook", webhookSecretEnc: "v1.a.b.c" });
  const invoice = await createInvoice(merchant);
  const quote = await createQuote(invoice);
  return { merchant, invoice, quote };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("applyStatus", () => {
  it("moves the invoice from detected to paid and queues one webhook per step", async () => {
    const { invoice, quote } = await openPayment();
    await applyStatus(quote.id, status("KNOWN_DEPOSIT_TX"));
    expect((await getDb().invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("detected");
    await applyStatus(quote.id, status("PROCESSING"));
    await applyStatus(quote.id, status("SUCCESS"));

    const paid = await getDb().invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(paid).toMatchObject({ status: "paid", paidQuoteId: quote.id, late: false });
    const events = await getDb().webhookDelivery.findMany({ orderBy: { createdAt: "asc" }, select: { eventType: true } });
    expect(events.map((event) => event.eventType)).toEqual(["invoice.detected", "invoice.paid"]);
    expect(await getDb().quote.findUniqueOrThrow({ where: { id: quote.id } })).toMatchObject({ state: "final", oneclickStatus: "SUCCESS" });
  });

  it("never moves a quote back to an earlier or older status", async () => {
    const { invoice, quote } = await openPayment();
    await applyStatus(quote.id, status("PROCESSING"));
    await applyStatus(quote.id, status("KNOWN_DEPOSIT_TX"));
    await applyStatus(quote.id, status("PROCESSING", new Date(Date.now() - 60_000)));
    expect((await getDb().quote.findUniqueOrThrow({ where: { id: quote.id } })).oneclickStatus).toBe("PROCESSING");

    await applyStatus(quote.id, status("SUCCESS"));
    await applyStatus(quote.id, status("REFUNDED"));
    expect((await getDb().quote.findUniqueOrThrow({ where: { id: quote.id } })).oneclickStatus).toBe("SUCCESS");
    expect((await getDb().invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("paid");
  });

  it("retires the invoice's other open addresses when it is paid", async () => {
    const { invoice, quote } = await openPayment();
    const other = await createQuote(invoice);
    await applyStatus(quote.id, status("SUCCESS"));
    expect(await getDb().quote.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ state: "retired" });
  });

  it("queues invoice.expired, with the invoice only, when a detected invoice falls back after its time ran out", async () => {
    const { invoice, quote: older } = await openPayment();
    await createQuote(invoice, { createdAt: new Date(Date.now() + 1_000) });
    await applyStatus(older.id, status("KNOWN_DEPOSIT_TX"));
    await getDb().invoice.update({ where: { id: invoice.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    await applyStatus(older.id, status("REFUNDED"));

    expect((await getDb().invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("expired");
    const events = await getDb().webhookDelivery.findMany({ orderBy: { createdAt: "asc" } });
    expect(events.map((event) => event.eventType)).toEqual(["invoice.detected", "invoice.expired"]);
    expect(events[1].payload).toMatchObject({ data: { invoice: { id: invoice.id, status: "expired" } } });
    expect((events[1].payload as { data: object }).data).not.toHaveProperty("payment");
  });

  it("queues the latest payment's outcome, with that payment, when a detected invoice falls back to it", async () => {
    const { invoice, quote: older } = await openPayment();
    const latest = await createQuote(invoice, { createdAt: new Date(Date.now() + 1_000), oneclickStatus: "REFUNDED", state: "final" });
    await applyStatus(older.id, status("KNOWN_DEPOSIT_TX"));
    await applyStatus(older.id, status("REFUNDED"));

    expect((await getDb().invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("refunded");
    const events = await getDb().webhookDelivery.findMany({ orderBy: { createdAt: "asc" } });
    expect(events.map((event) => event.eventType)).toEqual(["invoice.detected", "invoice.refunded"]);
    expect(events[1].payload).toMatchObject({ data: { invoice: { status: "refunded" }, payment: { id: latest.id, status: "refunded" } } });
  });

  it("records a payment event with the origin transaction for support lookups", async () => {
    const { quote } = await openPayment();
    await applyStatus(quote.id, status("KNOWN_DEPOSIT_TX"));
    const event = await getDb().paymentEvent.findFirstOrThrow({ where: { quoteId: quote.id } });
    expect(event.originTxs).toEqual([{ hash: DEPOSIT_TX, explorerUrl: "" }]);
  });
});

describe("invoice row locks", () => {
  it("make a second transaction wait until the first one ends", async () => {
    const { invoice } = await openPayment();
    const db = getDb();
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => (signalLocked = resolve));

    const first = db.$transaction(async (tx) => {
      await lockInvoice(tx, invoice.id);
      order.push("first locked");
      signalLocked();
      await held;
      order.push("first done");
    });
    await locked;
    const second = db.$transaction(async (tx) => {
      await lockInvoice(tx, invoice.id);
      order.push("second locked");
    });
    await sleep(300);
    order.push("released");
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first locked", "released", "first done", "second locked"]);
  });

  it("do not hold up work on another invoice", async () => {
    const { invoice } = await openPayment();
    const { invoice: other } = await openPayment();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => (signalLocked = resolve));
    const first = getDb().$transaction(async (tx) => {
      await lockInvoice(tx, invoice.id);
      signalLocked();
      await held;
    });
    await locked;
    await getDb().$transaction((tx) => lockInvoice(tx, other.id));
    release();
    await first;
  });

  it("make a status update wait for a request that holds the invoice", async () => {
    const { invoice, quote } = await openPayment();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => (signalLocked = resolve));
    const request = getDb().$transaction(async (tx) => {
      await lockInvoice(tx, invoice.id);
      signalLocked();
      await held;
    });
    await locked;

    let applied = false;
    const update = applyStatus(quote.id, status("KNOWN_DEPOSIT_TX")).then(() => (applied = true));
    await sleep(300);
    expect(applied).toBe(false);
    release();
    await Promise.all([request, update]);
    expect((await getDb().invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("detected");
  });
});
