import { deleteInBatches, getDb } from "@/lib/db";
import { DAY_MS } from "@/lib/time";

/** How long webhook logs, alerts, unmatched cases, link visits and demo payments are kept; live payments and transfers never go. */
const HISTORY_RETENTION_MS = 30 * DAY_MS;

/** Worker job: deletes finished webhook deliveries, alerts, cases matching no invoice, unused link invoices and demo payments after 30 days. */
export async function pruneOldHistory(): Promise<number> {
  const db = getDb();
  const before = new Date(Date.now() - HISTORY_RETENTION_MS);
  const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
  const deliveries = await deleteInBatches(
    async (take) => ids(await db.webhookDelivery.findMany({ where: { status: { not: "pending" }, createdAt: { lt: before } }, select: { id: true }, take })),
    (batch) => db.webhookDelivery.deleteMany({ where: { id: { in: batch } } }),
  );
  const alerts = await deleteInBatches(
    async (take) => ids(await db.alert.findMany({ where: { createdAt: { lt: before } }, select: { id: true }, take })),
    (batch) => db.alert.deleteMany({ where: { id: { in: batch } } }),
  );
  const cases = await deleteInBatches(
    async (take) => ids(await db.supportCase.findMany({ where: { invoiceId: null, createdAt: { lt: before } }, select: { id: true }, take })),
    (batch) => db.supportCase.deleteMany({ where: { id: { in: batch } } }),
  );
  return deliveries + alerts + cases + (await pruneVisitsAndDemos(before));
}

/** Deletes link invoices that expired before a coin was chosen (anyone can create one) and demo payments, older than `before`.
    Financial relations are `Restrict`, so payment events and quotes go first. */
async function pruneVisitsAndDemos(before: Date): Promise<number> {
  const db = getDb();
  return deleteInBatches(
    async (take) =>
      (
        await db.invoice.findMany({
          where: { createdAt: { lt: before }, OR: [{ mode: "test" }, { mode: "live", status: "expired", paymentLinkId: { not: null }, quotes: { none: {} } }] },
          select: { id: true },
          take,
        })
      ).map((row) => row.id),
    (batch) =>
      db.$transaction(async (tx) => {
        await tx.paymentEvent.deleteMany({ where: { quote: { invoiceId: { in: batch } } } });
        await tx.quote.deleteMany({ where: { invoiceId: { in: batch } } });
        return tx.invoice.deleteMany({ where: { id: { in: batch } } });
      }),
  );
}
