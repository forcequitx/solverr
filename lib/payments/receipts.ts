import { getDb } from "@/lib/db";
import { EmailRejectedError, emailEnabled, sendEmail } from "@/lib/email/send";
import { receiptEmail } from "@/lib/email/templates";
import { getEnv } from "@/lib/env";
import { reportError } from "@/lib/error-reports";
import { errorMessage, logger } from "@/lib/logger";
import { DAY_MS } from "@/lib/time";

const log = logger.child({ module: "receipts" });

const LOOKBACK_MS = 7 * DAY_MS;

/** Whether a receipt asked for now would still be sent: the payment is not paid yet, or was paid within the job's lookback. */
export function receiptStillSent(invoice: { status: string; paidAt: Date | null }): boolean {
  return invoice.status !== "paid" || (invoice.paidAt !== null && invoice.paidAt.getTime() > Date.now() - LOOKBACK_MS);
}

/** Worker job: emails a receipt link for paid live invoices with a customer email (never test mode); the idempotency key prevents a second copy. */
export async function sendReceipts(signal: AbortSignal): Promise<number> {
  if (!emailEnabled()) return 0;
  const db = getDb();
  const due = await db.invoice.findMany({
    where: { mode: "live", status: "paid", customerEmail: { not: null }, receiptSentAt: null, paidAt: { gt: new Date(Date.now() - LOOKBACK_MS) } },
    include: { merchant: { select: { name: true } } },
    orderBy: { paidAt: "asc" },
    take: 20,
  });
  for (const invoice of due) {
    if (signal.aborted) break;
    try {
      await sendEmail(
        {
          to: invoice.customerEmail!,
          ...(await receiptEmail({
            merchantName: invoice.merchant.name,
            amount: invoice.amount.toFixed(2),
            currency: invoice.currency,
            receiptUrl: new URL(`/receipt/${invoice.id}`, getEnv().APP_URL).toString(),
          })),
        },
        { idempotencyKey: `receipt/${invoice.id}` },
      );
      await db.invoice.updateMany({ where: { id: invoice.id, receiptSentAt: null }, data: { receiptSentAt: new Date() } });
    } catch (error) {
      log.error({ invoice: invoice.id, error: errorMessage(error) }, "Receipt email failed");
      /** A refused message is marked handled so it stops holding back newer receipts. */
      if (error instanceof EmailRejectedError) {
        await db.invoice.updateMany({ where: { id: invoice.id, receiptSentAt: null }, data: { receiptSentAt: new Date() } });
        continue;
      }
      /** Any other failure (a bad key, an unverified domain, an outage) hits every message alike: report it and retry next run. */
      reportError(error);
      break;
    }
  }
  return due.length;
}
