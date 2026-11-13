import { pruneIdempotencyRecords } from "@/lib/api/idempotency";
import { pruneRateLimits } from "@/lib/api/rate-limit";
import { pruneExpiredVerifications } from "@/lib/auth/verifications";
import { databaseReachable, getDb, isDatabaseUnreachable } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { flushErrorReports, reportError, startErrorReports } from "@/lib/error-reports";
import { errorMessage, logger } from "@/lib/logger";
import { ensureDemoStore } from "@/lib/merchants/demo-store";
import { checkHealth } from "@/lib/payments/health";
import { expireInvoices, pollQuotes, retireQuotes } from "@/lib/payments/lifecycle";
import { sendReceipts } from "@/lib/payments/receipts";
import { refreshRouteLimits } from "@/lib/payments/route-limits";
import { invoiceDueSubscriptions, sendSubscriptionPayLinks } from "@/lib/subscriptions/subscriptions";
import { telegramEnabled } from "@/lib/telegram/api";
import { notifyTelegramPaid } from "@/lib/telegram/bot";
import { pollTransfers } from "@/lib/transfers/execute";
import { deliverDueWebhooks } from "@/lib/webhooks/deliver";
import { HOUR_MS, MINUTE_MS } from "@/lib/time";
import { HEARTBEAT_MS, recordWorkerHeartbeat } from "@/lib/worker/heartbeat";
import { pruneOldHistory } from "@/lib/worker/retention";
import { checkWalArchiving } from "@/lib/worker/wal-archiving";

/** `lastRun` is a monotonic `performance.now()` time, so a wall-clock jump cannot stall jobs; 0 means the job has not run yet. */
type Job = { name: string; everyMs: number; run: (signal: AbortSignal) => Promise<unknown>; lastRun: number };

const log = logger.child({ module: "worker" });

const TICK_MS = 1_000;
/** Longest wait for queued error reports when the worker stops; Docker allows 60 s after SIGTERM. */
const FLUSH_TIMEOUT_MS = 5_000;
/** Jobs whose failure stops payments or their notices; the heartbeat reports the worker unhealthy when one has not succeeded for STALL_MS. */
const CRITICAL_JOBS = ["poll", "expire", "transfers", "webhooks"] as const;
const STALL_MS = 10 * MINUTE_MS;
/** When each job last finished without an error, as `performance.now()`; jobs that never did count from the worker's start. */
const lastSuccess = new Map<string, number>();
const startedAt = performance.now();

/** Critical jobs that have not succeeded within STALL_MS. */
function stalledJobs(): string[] {
  const now = performance.now();
  return CRITICAL_JOBS.filter((name) => now - (lastSuccess.get(name) ?? startedAt) > STALL_MS);
}
/** Jobs in one group run one after another; groups run side by side, so slow endpoints never delay payment updates. */
const groups: Job[][] = [
  [
    { name: "poll", everyMs: 5_000, run: pollQuotes, lastRun: 0 },
    { name: "retire", everyMs: 30_000, run: retireQuotes, lastRun: 0 },
    { name: "expire", everyMs: 30_000, run: expireInvoices, lastRun: 0 },
    { name: "transfers", everyMs: 15_000, run: pollTransfers, lastRun: 0 },
  ],
  [{ name: "webhooks", everyMs: 5_000, run: deliverDueWebhooks, lastRun: 0 }],
  [
    { name: "subscriptions", everyMs: MINUTE_MS, run: invoiceDueSubscriptions, lastRun: 0 },
    { name: "subscription-emails", everyMs: 30_000, run: sendSubscriptionPayLinks, lastRun: 0 },
    { name: "receipts", everyMs: 30_000, run: sendReceipts, lastRun: 0 },
  ],
  /** On its own, so a slow email service never delays "payment received" messages. */
  [{ name: "telegram", everyMs: 10_000, run: async (signal) => (telegramEnabled() ? notifyTelegramPaid(signal) : 0), lastRun: 0 }],
  /** A full refresh sends a few hundred dry quotes, so it runs in its own group and never holds up the jobs above. */
  [{ name: "route-limits", everyMs: 30 * MINUTE_MS, run: refreshRouteLimits, lastRun: 0 }],
  /** Alone in its group, so a slow job elsewhere cannot make a running worker look stopped. */
  [{ name: "heartbeat", everyMs: HEARTBEAT_MS, run: () => recordWorkerHeartbeat(stalledJobs()), lastRun: 0 }],
  [
    { name: "health", everyMs: 5 * MINUTE_MS, run: checkHealth, lastRun: 0 },
    { name: "wal-archiving", everyMs: 5 * MINUTE_MS, run: checkWalArchiving, lastRun: 0 },
    { name: "idempotency", everyMs: HOUR_MS, run: pruneIdempotencyRecords, lastRun: 0 },
    { name: "verifications", everyMs: HOUR_MS, run: pruneExpiredVerifications, lastRun: 0 },
    { name: "history", everyMs: HOUR_MS, run: pruneOldHistory, lastRun: 0 },
    { name: "rate-limits", everyMs: HOUR_MS, run: pruneRateLimits, lastRun: 0 },
    /** Runs at start, so the prerendered /demo page always finds its store; later runs only retry a failed attempt. */
    { name: "demo-store", everyMs: HOUR_MS, run: ensureDemoStore, lastRun: 0 },
  ],
];

const shutdown = new AbortController();
/** Set while the database cannot be reached; jobs keep retrying on their intervals without repeating the same error. */
let databaseDown = false;

/** The recovery check in progress; groups running side by side share it, so recovery is announced once. */
let recoveryCheck: Promise<void> | null = null;

/** Some jobs finish without touching the database, so recovery is confirmed with a query of its own. */
function confirmRecovery(): Promise<void> {
  recoveryCheck ??= databaseReachable()
    .then((reachable) => {
      if (reachable && databaseDown) {
        databaseDown = false;
        log.info("The database is reachable again; jobs are running");
      }
    })
    .finally(() => {
      recoveryCheck = null;
    });
  return recoveryCheck;
}

async function runGroup(jobs: Job[]): Promise<void> {
  const { signal } = shutdown;
  while (!signal.aborted) {
    for (const job of jobs) {
      const now = performance.now();
      if (signal.aborted || (job.lastRun !== 0 && now - job.lastRun < job.everyMs)) continue;
      job.lastRun = now;
      try {
        await job.run(signal);
        lastSuccess.set(job.name, performance.now());
        if (databaseDown) await confirmRecovery();
      } catch (error) {
        if (isDatabaseUnreachable(error)) {
          if (!databaseDown) log.error("The database is unreachable. Jobs retry on their own; check that the database is running and DATABASE_URL is correct");
          databaseDown = true;
        } else {
          log.error({ job: job.name, error: errorMessage(error) }, "Job failed");
          reportError(error, { job: job.name });
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, TICK_MS));
  }
}

async function main(): Promise<void> {
  /** Invalid settings stop the worker at once instead of failing every job on every tick. */
  getEnv();
  startErrorReports("worker");
  log.info("Started");
  await Promise.all(groups.map(runGroup));
  await getDb().$disconnect();
  await flushErrorReports(FLUSH_TIMEOUT_MS);
  log.info("Stopped");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => shutdown.abort());
}

main().catch(async (error) => {
  log.fatal({ error: errorMessage(error) }, "Crashed");
  reportError(error);
  await flushErrorReports(FLUSH_TIMEOUT_MS);
  process.exit(1);
});
