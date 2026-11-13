import { afterEach, describe, expect, it, vi } from "vitest";
import type { Merchant, Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/ids";
import { invoiceDueSubscriptions } from "@/lib/subscriptions/subscriptions";
import { createMerchant } from "./factories";

/** The token list prices subscription invoices; a gate can hold callers so concurrent worker runs overlap. */
const tokens = vi.hoisted(() => ({ gate: null as (() => Promise<void>) | null }));

vi.mock("@/lib/oneclick/tokens", async (importOriginal) => {
  const { TEST_TOKENS } = await import("./factories");
  return {
    ...(await importOriginal<typeof import("@/lib/oneclick/tokens")>()),
    findToken: async (assetId: string) => {
      await tokens.gate?.();
      return TEST_TOKENS.find((token) => token.assetId === assetId);
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
  tokens.gate = null;
});

/** Sets the clock the billing code reads through `new Date()` and `Date.now()`; timers stay real so database connections keep working. */
function setNow(iso: string): Date {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
  return new Date(iso);
}

/** Holds each caller until `count` have arrived, so concurrent worker runs all read the due subscription before any bills it. */
function meeting(count: number): () => Promise<void> {
  let arrived = 0;
  let open!: () => void;
  const allHere = new Promise<void>((resolve) => (open = resolve));
  return () => {
    if (++arrived === count) open();
    return allHere;
  };
}

const runWorker = () => invoiceDueSubscriptions(new AbortController().signal);
const billingMerchant = () => createMerchant({ webhookUrl: "https://shop.example/hook", webhookSecretEnc: "v1.a.b.c" });
const nextInvoiceAt = async (id: string) => (await getDb().subscription.findUniqueOrThrow({ where: { id } })).nextInvoiceAt.toISOString();
const invoicesOf = (subscriptionId: string) => getDb().invoice.findMany({ where: { subscriptionId }, orderBy: { createdAt: "asc" } });

/** A monthly 9 USD subscription created at `start` and first due then; its billing day is the day of `start`. */
function createSubscription(merchant: Pick<Merchant, "id">, start: string, overrides: Partial<Prisma.SubscriptionUncheckedCreateInput> = {}) {
  return getDb().subscription.create({
    data: {
      id: newId("sub"),
      merchantId: merchant.id,
      customerEmail: "ana@example.com",
      amount: "9.00",
      currency: "USD",
      interval: "month",
      createdAt: new Date(start),
      nextInvoiceAt: new Date(start),
      ...overrides,
    },
  });
}

describe("invoiceDueSubscriptions", () => {
  it("creates one live invoice and one subscription.invoice_created webhook per due subscription", async () => {
    const now = setNow("2026-03-10T12:00:00.000Z");
    const merchant = await billingMerchant();
    const monthly = await createSubscription(merchant, "2026-03-10T09:00:00.000Z");
    const weekly = await createSubscription(merchant, "2026-03-03T09:00:00.000Z", { interval: "week", nextInvoiceAt: new Date("2026-03-10T11:00:00.000Z"), customerEmail: "bo@example.com" });
    const later = await createSubscription(merchant, "2026-02-11T09:00:00.000Z", { nextInvoiceAt: new Date("2026-03-11T09:00:00.000Z") });

    expect(await runWorker()).toBe(2);
    const [monthlyInvoices, weeklyInvoices, laterInvoices] = await Promise.all([invoicesOf(monthly.id), invoicesOf(weekly.id), invoicesOf(later.id)]);
    expect(monthlyInvoices).toHaveLength(1);
    expect(weeklyInvoices).toHaveLength(1);
    expect(laterInvoices).toHaveLength(0);
    expect(monthlyInvoices[0]).toMatchObject({ merchantId: merchant.id, mode: "live", status: "created", currency: "USD", customerEmail: "ana@example.com", description: "Monthly subscription", amountOutBase: "9000000" });
    expect(monthlyInvoices[0].amount.toFixed(2)).toBe("9.00");
    expect(monthlyInvoices[0].expiresAt.getTime()).toBe(now.getTime() + 86_400_000);
    expect(weeklyInvoices[0]).toMatchObject({ customerEmail: "bo@example.com", description: "Weekly subscription" });

    const deliveries = await getDb().webhookDelivery.findMany({ where: { merchantId: merchant.id } });
    expect(deliveries.map((delivery) => delivery.eventType)).toEqual(["subscription.invoice_created", "subscription.invoice_created"]);
    const announced = deliveries.map((delivery) => (delivery.payload as { data: { invoice: { id: string } } }).data.invoice.id);
    expect(announced.sort()).toEqual([monthlyInvoices[0].id, weeklyInvoices[0].id].sort());

    expect(await nextInvoiceAt(monthly.id)).toBe("2026-04-10T09:00:00.000Z");
    expect(await nextInvoiceAt(weekly.id)).toBe("2026-03-17T11:00:00.000Z");
    expect(await nextInvoiceAt(later.id)).toBe("2026-03-11T09:00:00.000Z");

    expect(await runWorker()).toBe(0);
    expect(await getDb().invoice.count()).toBe(2);
    expect(await getDb().webhookDelivery.count()).toBe(2);
  });

  it("bills a due subscription once when two worker runs pick it up at the same time", async () => {
    setNow("2026-03-10T12:00:00.000Z");
    const merchant = await billingMerchant();
    const subscription = await createSubscription(merchant, "2026-03-10T09:00:00.000Z");
    tokens.gate = meeting(2);

    await Promise.all([runWorker(), runWorker()]);
    expect(await invoicesOf(subscription.id)).toHaveLength(1);
    expect(await getDb().webhookDelivery.count({ where: { merchantId: merchant.id } })).toBe(1);
    expect(await nextInvoiceAt(subscription.id)).toBe("2026-04-10T09:00:00.000Z");
  });

  it.each([
    { year: 2026, february: "2026-02-28" },
    { year: 2028, february: "2028-02-29" },
  ])("bills a subscription started on January 31 on the last day of February, then on March 31 ($year)", async ({ year, february }) => {
    setNow(`${year}-01-31T10:00:01.000Z`);
    const subscription = await createSubscription(await billingMerchant(), `${year}-01-31T10:00:00.000Z`);
    await runWorker();
    expect(await nextInvoiceAt(subscription.id)).toBe(`${february}T10:00:00.000Z`);

    setNow(`${february}T09:59:59.000Z`);
    expect(await runWorker()).toBe(0);

    setNow(`${february}T10:00:01.000Z`);
    await runWorker();
    expect(await nextInvoiceAt(subscription.id)).toBe(`${year}-03-31T10:00:00.000Z`);

    setNow(`${year}-03-31T10:00:01.000Z`);
    await runWorker();
    expect(await nextInvoiceAt(subscription.id)).toBe(`${year}-04-30T10:00:00.000Z`);
    expect(await invoicesOf(subscription.id)).toHaveLength(3);
  });

  it("bills an overdue subscription once, not once per missed period, and moves it to the next billing date", async () => {
    setNow("2026-04-20T12:00:00.000Z");
    const merchant = await billingMerchant();
    const subscription = await createSubscription(merchant, "2026-01-15T08:00:00.000Z");

    expect(await runWorker()).toBe(1);
    expect(await nextInvoiceAt(subscription.id)).toBe("2026-05-15T08:00:00.000Z");
    expect(await runWorker()).toBe(0);
    expect(await invoicesOf(subscription.id)).toHaveLength(1);
    expect(await getDb().webhookDelivery.count({ where: { merchantId: merchant.id } })).toBe(1);
  });

  it("does not bill a canceled subscription", async () => {
    setNow("2026-03-10T12:00:00.000Z");
    const merchant = await billingMerchant();
    const subscription = await createSubscription(merchant, "2026-03-10T09:00:00.000Z", { status: "canceled" });

    expect(await runWorker()).toBe(0);
    expect(await invoicesOf(subscription.id)).toHaveLength(0);
    expect(await getDb().webhookDelivery.count()).toBe(0);
    expect(await nextInvoiceAt(subscription.id)).toBe("2026-03-10T09:00:00.000Z");
  });

  it("does not bill a subscription canceled while the run prices its invoice", async () => {
    setNow("2026-03-10T12:00:00.000Z");
    const merchant = await billingMerchant();
    const subscription = await createSubscription(merchant, "2026-03-10T09:00:00.000Z");
    tokens.gate = async () => {
      await getDb().subscription.update({ where: { id: subscription.id }, data: { status: "canceled" } });
    };

    await runWorker();
    expect(await invoicesOf(subscription.id)).toHaveLength(0);
    expect(await getDb().webhookDelivery.count()).toBe(0);
    expect(await nextInvoiceAt(subscription.id)).toBe("2026-03-10T09:00:00.000Z");
  });
});
