import type { Quote } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { reportError } from "@/lib/error-reports";
import { serializeInvoice } from "@/lib/invoices/serialize";
import { PAYABLE_STATUSES } from "@/lib/invoices/statuses";
import { errorMessage, logger } from "@/lib/logger";
import { paymentNetwork } from "@/lib/oneclick/network";
import { applyStatus, POLL_MS } from "@/lib/payments/apply-status";
import { notifyCheckout } from "@/lib/payments/checkout-events";
import { REPORTED_GRACE_MS, reportedInFlight, RETIRED_WATCH_MS } from "@/lib/payments/quote";
import { lockInvoice } from "@/lib/row-locks";
import { enqueueWebhook } from "@/lib/webhooks/events";
import { BATCH_BUDGET_MS, CLAIM_LEASE_MS } from "@/lib/worker/claims";

const log = logger.child({ module: "poll" });

const POLL_BATCH = 50;
/** Ranked due quotes a claim picks its batch from, so rows another worker holds can be skipped without leaving the batch short. */
const CLAIM_POOL = POLL_BATCH * 4;
/** Status checks in flight at once; the 1Click client's rate limit (5 a second) still decides how fast they go. */
const POLL_LANES = 4;
const RETIRE_BATCH = 100;
const EXPIRE_BATCH = 100;
/** Expiry shares its worker group with payment polling, so one run stops taking new batches after this long. */
const EXPIRE_BUDGET_MS = 10_000;

/** Runs `step` for one row; a failure is logged and reported, so one bad row never stops the rest of the batch. */
async function eachRow<T extends { id: string }>(rows: T[], what: string, step: (row: T) => Promise<void>): Promise<void> {
  for (const row of rows) {
    try {
      await step(row);
    } catch (error) {
      log.error({ id: row.id, error: errorMessage(error) }, `${what} failed`);
      reportError(error, { job: what, id: row.id });
    }
  }
}

/** Expires ended unpaid invoices oldest first and retires their addresses, in batches until none is due or EXPIRE_BUDGET_MS is used.
    A payment-link invoice that never got an address expires without a webhook: it was only a page visit. */
export async function expireInvoices(signal: AbortSignal): Promise<number> {
  const db = getDb();
  const started = Date.now();
  let expired = 0;
  while (!signal.aborted && Date.now() - started < EXPIRE_BUDGET_MS) {
    const due = await db.invoice.findMany({
      where: { status: { in: [...PAYABLE_STATUSES] }, expiresAt: { lt: new Date() } },
      include: { merchant: true },
      orderBy: { expiresAt: "asc" },
      take: EXPIRE_BATCH,
    });
    await eachRow(due, "Expiry", (invoice) =>
      db.$transaction(async (tx) => {
        const updated = await tx.invoice.updateMany({ where: { id: invoice.id, status: invoice.status }, data: { status: "expired" } });
        if (updated.count === 0) return;
        await tx.quote.updateMany({
          where: { invoiceId: invoice.id, state: "active" },
          data: { state: "retired", watchUntil: new Date(Date.now() + RETIRED_WATCH_MS) },
        });
        const visitOnly = invoice.status === "created" && invoice.paymentLinkId !== null;
        if (!visitOnly) await enqueueWebhook(tx, invoice.merchant, invoice.mode, "invoice.expired", { invoice: serializeInvoice({ ...invoice, status: "expired" }) });
        await notifyCheckout(tx, invoice.id);
      }),
    );
    expired += due.length;
    if (due.length < EXPIRE_BATCH) break;
  }
  return expired;
}

/** Retires active quotes past their deadline with no deposit, and stops watching retired ones after 24 hours. */
export async function retireQuotes(): Promise<void> {
  const db = getDb();
  const now = new Date();
  const stale = await db.quote.findMany({
    where: { state: "active", oneclickStatus: "PENDING_DEPOSIT", deadline: { lt: now } },
    select: { id: true, invoiceId: true, deadline: true },
    orderBy: { deadline: "asc" },
    take: RETIRE_BATCH,
  });
  /** Conditional, so a quote that a status update just finished is not moved back to retired. */
  await eachRow(stale, "Retiring", (quote) =>
    db.$transaction(async (tx) => {
      /** Locked like `applyStatus`, so a status update in flight never writes the quote back as active. */
      await lockInvoice(tx, quote.invoiceId);
      const retired = await tx.quote.updateMany({
        where: { id: quote.id, state: "active", oneclickStatus: "PENDING_DEPOSIT" },
        data: { state: "retired", watchUntil: new Date(quote.deadline.getTime() + RETIRED_WATCH_MS) },
      });
      if (retired.count > 0) await notifyCheckout(tx, quote.invoiceId);
    }),
  );
  await db.quote.updateMany({ where: { state: "retired", oneclickStatus: "PENDING_DEPOSIT", watchUntil: { lt: now } }, data: { state: "final" } });
}

/** Claims up to POLL_BATCH due quotes (lease CLAIM_LEASE_MS): payments under way first, businesses taking turns, then open addresses.
    Unseen reports count as under way only for REPORTED_GRACE_MS. Rows another worker holds are skipped from a ranked pool of CLAIM_POOL. */
async function claimDueQuotes(): Promise<string[]> {
  const db = getDb();
  const now = new Date();
  const reportExpired = new Date(now.getTime() - REPORTED_GRACE_MS);
  /** A test quote changes only once simulated (`simulatePayment` schedules it then), so until then it waits past its watch instead of staying due. */
  await db.$executeRaw`
    UPDATE quotes q SET next_poll_at = q.deadline + ${RETIRED_WATCH_MS} * interval '1 millisecond'
    FROM invoices i
    WHERE i.id = q.invoice_id AND i.mode = 'test' AND q.simulated_at IS NULL AND q.state IN ('active', 'retired') AND q.next_poll_at <= ${now}`;
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE quotes SET next_poll_at = ${new Date(now.getTime() + CLAIM_LEASE_MS)}
    WHERE id IN (
      SELECT q.id FROM quotes q
      JOIN (
        SELECT q.id, q.state, q.next_poll_at,
          (q.oneclick_status = 'PENDING_DEPOSIT' AND ((q.deposit_tx_hash IS NULL AND q.wallet_sent_at IS NULL) OR q.deadline <= ${reportExpired})) AS waiting,
          ROW_NUMBER() OVER (
            PARTITION BY i.merchant_id
            ORDER BY (q.oneclick_status = 'PENDING_DEPOSIT' AND ((q.deposit_tx_hash IS NULL AND q.wallet_sent_at IS NULL) OR q.deadline <= ${reportExpired})), q.state, q.next_poll_at
          ) AS merchant_rank
        FROM quotes q JOIN invoices i ON i.id = q.invoice_id
        WHERE q.state IN ('active', 'retired') AND q.next_poll_at <= ${now} AND (i.mode = 'live' OR q.simulated_at IS NOT NULL)
        ORDER BY waiting, merchant_rank, state, next_poll_at
        LIMIT ${CLAIM_POOL}
      ) due ON due.id = q.id
      WHERE q.next_poll_at <= ${now}
      ORDER BY due.waiting, due.merchant_rank, due.state, due.next_poll_at
      LIMIT ${POLL_BATCH}
      FOR UPDATE OF q SKIP LOCKED
    )
    RETURNING id`;
  return rows.map((row) => row.id);
}

/** Whether a quote shows payment activity: a status past waiting for the deposit, or a reported transaction still in flight. */
const underWay = (quote: Pick<Quote, "depositTxHash" | "walletSentAt" | "oneclickStatus" | "deadline">) => quote.oneclickStatus !== "PENDING_DEPOSIT" || reportedInFlight(quote);

/** Polls due quotes, payments under way first, over POLL_LANES so one slow answer does not idle the rest; quotes not reached
    before shutdown or BATCH_BUDGET_MS are handed back for the next run. */
export async function pollQuotes(signal: AbortSignal): Promise<number> {
  const db = getDb();
  const started = Date.now();
  const due = await db.quote.findMany({
    where: { id: { in: await claimDueQuotes() } },
    include: { invoice: { select: { mode: true } } },
    orderBy: { state: "asc" },
  });
  due.sort((a, b) => Number(underWay(b)) - Number(underWay(a)));
  /** One outage fails every quote alike, so the run reports its first failure once, with a count; each quote is still logged. */
  let failures = 0;
  let firstFailure: unknown;
  const handedBack: string[] = [];
  let next = 0;
  const lane = async () => {
    while (next < due.length) {
      const quote = due[next++];
      if (signal.aborted || Date.now() - started > BATCH_BUDGET_MS) {
        handedBack.push(quote.id);
        continue;
      }
      try {
        await applyStatus(quote.id, await paymentNetwork(quote.invoice.mode).status(quote));
      } catch (error) {
        log.error({ quote: quote.id, error: errorMessage(error) }, "Status check failed");
        if (failures++ === 0) firstFailure = error;
        await db.quote.update({ where: { id: quote.id }, data: { nextPollAt: new Date(Date.now() + POLL_MS.error) } });
      }
    }
  };
  await Promise.all(Array.from({ length: POLL_LANES }, lane));
  if (handedBack.length > 0) await db.quote.updateMany({ where: { id: { in: handedBack } }, data: { nextPollAt: new Date() } });
  if (failures > 0) reportError(firstFailure, { job: "poll", failures: String(failures), of: String(due.length) });
  return due.length;
}
