import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Quote } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import type { StatusResponse } from "@/lib/oneclick/types";
import { pollQuotes } from "@/lib/payments/lifecycle";
import { createInvoice, createMerchant, createQuote } from "./factories";

/** Stands in for 1Click: records which quotes were polled, in order, and answers with the status each already has. */
const network = vi.hoisted(() => ({ polled: [] as string[], delayMs: 0, fail: false }));

vi.mock("@/lib/oneclick/network", () => ({
  paymentNetwork: () => ({
    async status(quote: Quote): Promise<StatusResponse> {
      network.polled.push(quote.id);
      if (network.delayMs) await new Promise((resolve) => setTimeout(resolve, network.delayMs));
      if (network.fail) throw new Error("1Click is not answering");
      return {
        correlationId: quote.correlationId,
        status: quote.oneclickStatus,
        updatedAt: new Date().toISOString(),
        swapDetails: { intentHashes: [], nearTxHashes: [], originChainTxHashes: [], destinationChainTxHashes: [] },
      };
    },
  }),
}));

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
const run = () => pollQuotes(new AbortController().signal);

/** `count` waiting quotes on one invoice of `merchant`, the oldest due first. */
async function waitingQuotes(merchant: { id: string }, count: number, dueMinutesAgo = 30): Promise<Quote[]> {
  const invoice = await createInvoice(merchant);
  const quotes: Quote[] = [];
  for (let index = 0; index < count; index++) quotes.push(await createQuote(invoice, { nextPollAt: minutesAgo(dueMinutesAgo + count - index) }));
  return quotes;
}

beforeEach(() => {
  network.polled = [];
  network.delayMs = 0;
  network.fail = false;
});

describe("pollQuotes claiming", () => {
  it("polls payments under way before waiting addresses, even when they became due last", async () => {
    const merchant = await createMerchant();
    await waitingQuotes(merchant, 60);
    const invoice = await createInvoice(merchant);
    const moving = await createQuote(invoice, { oneclickStatus: "KNOWN_DEPOSIT_TX" });
    const reported = await createQuote(invoice, { depositTxHash: "0xreported", deadline: minutesAgo(-5) });

    expect(await run()).toBe(50);
    expect(network.polled.slice(0, 2).sort()).toEqual([moving.id, reported.id].sort());
  });

  it("polls a payment the wallet reported as sent without a hash (TON) before waiting addresses", async () => {
    const merchant = await createMerchant();
    await waitingQuotes(merchant, 60);
    const invoice = await createInvoice(merchant);
    const sent = await createQuote(invoice, { walletSentAt: new Date(), deadline: minutesAgo(-5) });

    expect(await run()).toBe(50);
    expect(network.polled[0]).toBe(sent.id);
  });

  it("stops favouring a reported payment an hour after its address's deadline", async () => {
    const merchant = await createMerchant();
    await waitingQuotes(merchant, 60);
    const invoice = await createInvoice(merchant);
    const stale = await createQuote(invoice, { depositTxHash: "0xmadeup", deadline: minutesAgo(61) });

    await run();
    expect(network.polled).not.toContain(stale.id);
  });

  it("lets businesses take turns, so one busy business cannot hold up another", async () => {
    const busy = await createMerchant({ name: "Busy" });
    const small = await createMerchant({ name: "Small" });
    await waitingQuotes(busy, 60, 60);
    const smallQuotes = await waitingQuotes(small, 3, 0);

    expect(await run()).toBe(50);
    for (const quote of smallQuotes) expect(network.polled).toContain(quote.id);
  });

  it("parks a demo-store quote until it is simulated, and polls it once it is", async () => {
    const merchant = await createMerchant();
    const demo = await createInvoice(merchant, { mode: "test" });
    const unsimulated = await createQuote(demo);
    const simulated = await createQuote(demo, { simulatedAt: new Date(), simulatedOutcome: "paid" });
    const live = await createQuote(await createInvoice(merchant));

    await run();
    expect(network.polled.sort()).toEqual([simulated.id, live.id].sort());
    const parked = await getDb().quote.findUniqueOrThrow({ where: { id: unsimulated.id } });
    expect(parked.nextPollAt.getTime()).toBe(unsimulated.deadline.getTime() + 24 * 60 * 60_000);
  });

  it("never gives two concurrent runs the same quote", async () => {
    for (const name of ["A", "B", "C"]) await waitingQuotes(await createMerchant({ name }), 30);
    network.delayMs = 20;

    const counts = await Promise.all([run(), run()]);
    expect(counts[0] + counts[1]).toBe(90);
    expect(network.polled).toHaveLength(90);
    expect(new Set(network.polled).size).toBe(90);
  });

  it("does not claim a quote again until its next poll is due", async () => {
    await waitingQuotes(await createMerchant(), 5);
    expect(await run()).toBe(5);
    expect(await run()).toBe(0);
  });

  it("schedules a quote again after a failed status check", async () => {
    const [quote] = await waitingQuotes(await createMerchant(), 1);
    network.fail = true;
    await run();
    const after = await getDb().quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(after.nextPollAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(after.nextPollAt.getTime()).toBeLessThan(Date.now() + 40_000);
  });

  it("hands claimed quotes back at once when the worker is stopping", async () => {
    const quotes = await waitingQuotes(await createMerchant(), 3);
    const stopping = new AbortController();
    stopping.abort();

    expect(await pollQuotes(stopping.signal)).toBe(3);
    expect(network.polled).toEqual([]);
    const after = await getDb().quote.findMany({ where: { id: { in: quotes.map((quote) => quote.id) } } });
    for (const quote of after) expect(quote.nextPollAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
