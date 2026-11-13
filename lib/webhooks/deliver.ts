import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { Merchant, WebhookDelivery } from "@/generated/prisma/client";
import { decryptSecret } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { reportError } from "@/lib/error-reports";
import { errorMessage, logger } from "@/lib/logger";
import { alertOwner } from "@/lib/merchants/alerts";
import { HOUR_MS, MINUTE_MS } from "@/lib/time";
import { webhookEndpoint, WEBHOOKS_OFF_MESSAGE } from "@/lib/webhooks/endpoint";
import { signedHeaders } from "@/lib/webhooks/signature";
import { checkWebhookUrl, type WebhookTarget } from "@/lib/webhooks/url";

const log = logger.child({ module: "webhooks" });

/** Wait before each retry; the first attempt is immediate, so a delivery gets up to 9 attempts over about 2.7 days. */
const RETRY_DELAYS_MS = [MINUTE_MS, 5 * MINUTE_MS, 30 * MINUTE_MS, 2 * HOUR_MS, 5 * HOUR_MS, 10 * HOUR_MS, 24 * HOUR_MS, 24 * HOUR_MS];
/** Each wait is moved by up to this share either way, so retries from one outage do not all arrive at once. */
const RETRY_JITTER = 0.1;
/** Answers that ask the sender to slow down; their `Retry-After` is honoured, up to MAX_RETRY_AFTER_MS. */
const THROTTLE_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);
const MAX_RETRY_AFTER_MS = 24 * HOUR_MS;
/** The answer with which an endpoint asks never to receive events again (Standard Webhooks). */
const GONE_STATUS = 410;
const TIMEOUT_MS = 10_000;
/** A delivery being sent is hidden from other senders for this long; a crashed send is retried after it. */
const LEASE_MS = 60_000;
const DUE_BATCH = 100;
const PER_MERCHANT = 20;
const LANES = 4;
/** One "webhook failed" alert per business in this window, however many deliveries fail. */
const FAILURE_ALERT_INTERVAL_MS = 24 * HOUR_MS;
const UNREADABLE_SECRET_MESSAGE = "The webhook signing secret could not be read. Rotate the signing secret in Dashboard → Developers.";
/** How long a business's deliveries wait after its endpoint did not answer, which holds a lane for up to TIMEOUT_MS. */
const UNREACHABLE_PAUSE_MS = 5 * MINUTE_MS;
/** A failed answer that took this long also pauses the endpoint: each such delivery holds a lane almost as long as a timeout. */
const SLOW_FAILURE_MS = 5_000;
/** Sending time one business gets in a run; deliveries beyond it wait for the next run, so slow endpoints cannot hold the job. */
const MERCHANT_RUN_BUDGET_MS = 15_000;

/** `unreachable` means no HTTP answer at all: a timeout or a connection error. `ended` means webhooks are off or have no URL,
    so the delivery fails at once instead of retrying against an endpoint the owner removed. */
type Outcome = { ok: boolean; responseCode?: number; error?: string; retryAfterMs?: number; unreachable?: boolean; ended?: boolean };

/** The wait a `Retry-After` header asks for, in seconds or as an HTTP date; undefined when absent or unreadable. */
function retryAfterMs(header: string | string[] | undefined): number | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(date - Date.now(), 0);
}

/** The wait before retry number `attempts`, moved randomly by RETRY_JITTER and stretched to a longer `Retry-After`; undefined after the last. */
function retryDelay(attempts: number, outcome: Outcome): number | undefined {
  const scheduled = RETRY_DELAYS_MS[attempts - 1];
  if (scheduled === undefined) return undefined;
  const jittered = scheduled * (1 - RETRY_JITTER + Math.random() * 2 * RETRY_JITTER);
  return Math.min(Math.max(jittered, outcome.retryAfterMs ?? 0), MAX_RETRY_AFTER_MS);
}

/** POSTs to a checked webhook target, connecting only to the checked addresses so a later DNS change cannot reach a private network.
    Redirects are not followed; resolves with the HTTP status and its `Retry-After`. */
function postToTarget(target: WebhookTarget, headers: Record<string, string>, body: string): Promise<{ status: number; retryAfter?: string | string[] }> {
  const lookup: LookupFunction | undefined =
    target.addresses.length === 0
      ? undefined
      : (_hostname, options, callback) => {
          if (options.all) callback(null, target.addresses.map((address) => ({ address, family: isIP(address) })));
          else callback(null, target.addresses[0], isIP(target.addresses[0]));
        };
  const send = target.url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const request = send(
      target.url,
      { method: "POST", lookup, signal: AbortSignal.timeout(TIMEOUT_MS), headers: { ...headers, "content-length": String(Buffer.byteLength(body)) } },
      (response) => {
        response.resume();
        resolve({ status: response.statusCode ?? 0, retryAfter: response.headers["retry-after"] });
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

async function post(merchant: Merchant, delivery: WebhookDelivery): Promise<Outcome> {
  if (merchant.webhookDisabledAt) return { ok: false, error: WEBHOOKS_OFF_MESSAGE, ended: true };
  /** Only live events are ever queued (`enqueueWebhook`), so a delivery always goes to the live endpoint. */
  const endpoint = webhookEndpoint(merchant, "live");
  if (!endpoint) return { ok: false, error: "No webhook URL is set.", ended: true };
  const checked = await checkWebhookUrl(endpoint.url);
  if ("problem" in checked) return { ok: false, error: checked.problem };

  const [currentEnc, ...previousEnc] = endpoint.secretsEnc;
  let secrets: string[];
  try {
    secrets = [decryptSecret(currentEnc)];
  } catch (error) {
    /** A server setting problem (such as a changed ENCRYPTION_KEY): reported, and counted as a failed attempt so the owner is told. */
    reportError(error, { delivery: delivery.id });
    return { ok: false, error: UNREADABLE_SECRET_MESSAGE };
  }
  /** A previous secret still in its rotation overlap only adds a signature; one that cannot be read is left out, so rotating fixes it. */
  for (const encrypted of previousEnc) {
    try {
      secrets.push(decryptSecret(encrypted));
    } catch (error) {
      reportError(error, { delivery: delivery.id });
    }
  }
  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  try {
    const { status, retryAfter } = await postToTarget(
      checked.target,
      { "content-type": "application/json", "user-agent": "Solverr-Webhooks/1", ...signedHeaders(secrets, delivery.id, timestamp, body) },
      body,
    );
    if (status >= 200 && status < 300) return { ok: true, responseCode: status };
    return { ok: false, responseCode: status, error: `HTTP ${status}`, retryAfterMs: THROTTLE_STATUSES.has(status) ? retryAfterMs(retryAfter) : undefined };
  } catch (error) {
    return { ok: false, error: (error as Error).message.slice(0, 200), unreachable: true };
  }
}

/** Turns webhooks off for a business whose endpoint answered 410 Gone, fails its waiting deliveries and tells the owner once. */
async function disableEndpoint(merchant: Merchant): Promise<void> {
  const db = getDb();
  const disabled = await db.$transaction(async (tx) => {
    const updated = await tx.merchant.updateMany({ where: { id: merchant.id, webhookDisabledAt: null }, data: { webhookDisabledAt: new Date() } });
    if (updated.count === 0) return false;
    /** The log shows a response code before the error, so an earlier attempt's code is cleared to show why the delivery ended. */
    await tx.webhookDelivery.updateMany({
      where: { merchantId: merchant.id, status: "pending" },
      data: { status: "failed", nextRetryAt: null, responseCode: null, lastError: WEBHOOKS_OFF_MESSAGE },
    });
    return true;
  });
  if (disabled) await alertOwner(merchant, "webhook_failed", WEBHOOKS_OFF_MESSAGE, "/dashboard/developers");
}

/** Hides the delivery from other senders for LEASE_MS, if nobody changed it since it was read; false when someone did. */
async function leaseDelivery(delivery: WebhookDelivery): Promise<boolean> {
  const leased = await getDb().webhookDelivery.updateMany({
    where: { id: delivery.id, attempts: delivery.attempts, status: delivery.status, nextRetryAt: delivery.nextRetryAt },
    data: { nextRetryAt: new Date(Date.now() + LEASE_MS) },
  });
  return leased.count > 0;
}

/** Pauses a business's deliveries for UNREACHABLE_PAUSE_MS after its endpoint did not answer, or failed slowly. */
function pauseEndpoint(merchantId: string) {
  return getDb().merchant.update({ where: { id: merchantId }, data: { webhookPausedUntil: new Date(Date.now() + UNREACHABLE_PAUSE_MS) } });
}

/** Records a failed attempt of a leased delivery: a retry on the schedule, or failed after the last one (owner alerted at most daily).
    `alerted` holds the businesses already alerted in this run, so parallel lanes failing at once raise one alert. */
async function recordFailure(delivery: WebhookDelivery & { merchant: Merchant }, outcome: Outcome, alerted: Set<string>): Promise<void> {
  const db = getDb();
  const attempts = delivery.attempts + 1;
  const delay = retryDelay(attempts, outcome);
  await db.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      attempts,
      status: delay === undefined ? "failed" : "pending",
      responseCode: outcome.responseCode ?? null,
      lastError: outcome.error ?? null,
      nextRetryAt: delay === undefined ? null : new Date(Date.now() + delay),
    },
  });
  /** A resend of an already failed delivery does not alert again, and a failing endpoint raises one alert a day, not one per event. */
  if (delay === undefined && delivery.status !== "failed" && !alerted.has(delivery.merchantId)) {
    alerted.add(delivery.merchantId);
    const alertedToday = await db.alert.count({ where: { merchantId: delivery.merchantId, kind: "webhook_failed", createdAt: { gte: new Date(Date.now() - FAILURE_ALERT_INTERVAL_MS) } } });
    if (alertedToday === 0) {
      const message = `Webhook ${delivery.eventType} (${delivery.id}) failed after ${attempts} attempts: ${outcome.error ?? "no response"}. Other failures in the next 24 hours appear only in the delivery log.`;
      await alertOwner(delivery.merchant, "webhook_failed", message, "/dashboard/developers");
    }
  }
}

/** Counts the sibling's failed attempt for an unsent due delivery whose endpoint just failed, so a dead endpoint fails events out on schedule. */
async function failLikeSibling(delivery: WebhookDelivery & { merchant: Merchant }, outcome: Outcome, alerted: Set<string>): Promise<void> {
  if (await leaseDelivery(delivery)) await recordFailure(delivery, outcome, alerted);
}

/** Leases one delivery, sends it and records the attempt, scheduling a retry or giving up after the last one. */
export async function sendDelivery(delivery: WebhookDelivery & { merchant: Merchant }, alerted = new Set<string>()): Promise<Outcome> {
  const db = getDb();
  if (!(await leaseDelivery(delivery))) return { ok: false, error: "This event is already being sent." };

  const outcome = await post(delivery.merchant, delivery);
  const attempts = delivery.attempts + 1;

  if (outcome.ok) {
    await db.webhookDelivery.update({
      where: { id: delivery.id },
      data: { attempts, status: "delivered", responseCode: outcome.responseCode, lastError: null, deliveredAt: new Date(), nextRetryAt: null },
    });
    /** Checked in the database, not the batch's snapshot, so a pause set by another delivery in the same run is cleared too. */
    await db.merchant.updateMany({ where: { id: delivery.merchantId, webhookPausedUntil: { not: null } }, data: { webhookPausedUntil: null } });
    return outcome;
  }
  if (outcome.unreachable) await pauseEndpoint(delivery.merchantId);

  if (outcome.ended) {
    await db.webhookDelivery.update({
      where: { id: delivery.id },
      data: { attempts, status: "failed", responseCode: null, lastError: outcome.error ?? null, nextRetryAt: null },
    });
    return outcome;
  }

  if (outcome.responseCode === GONE_STATUS) {
    await db.webhookDelivery.update({
      where: { id: delivery.id },
      data: { attempts, status: "failed", responseCode: GONE_STATUS, lastError: WEBHOOKS_OFF_MESSAGE, nextRetryAt: null },
    });
    await disableEndpoint(delivery.merchant);
    return { ...outcome, error: WEBHOOKS_OFF_MESSAGE };
  }

  await recordFailure(delivery, outcome, alerted);
  return outcome;
}

/** Worker job: delivers due webhooks over parallel lanes; businesses take turns, each capped at PER_MERCHANT and MERCHANT_RUN_BUDGET_MS,
    paused endpoints skipped. An endpoint that does not answer or fails slowly is paused and its other due deliveries fail alike. */
export async function deliverDueWebhooks(signal: AbortSignal): Promise<number> {
  const db = getDb();
  const now = new Date();
  const due = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM (
      SELECT d.id, d.next_retry_at, ROW_NUMBER() OVER (PARTITION BY d.merchant_id ORDER BY d.next_retry_at) AS merchant_rank
      FROM webhook_deliveries d JOIN merchants m ON m.id = d.merchant_id
      WHERE d.status = 'pending' AND d.next_retry_at <= ${now} AND (m.webhook_paused_until IS NULL OR m.webhook_paused_until <= ${now})
    ) ranked
    WHERE merchant_rank <= ${PER_MERCHANT}
    ORDER BY merchant_rank, next_retry_at
    LIMIT ${DUE_BATCH}`;
  const rows = await db.webhookDelivery.findMany({ where: { id: { in: due.map((row) => row.id) } }, include: { merchant: true } });
  /** Kept in the query's order, so businesses still take turns. */
  const byId = new Map(rows.map((row) => [row.id, row]));
  const batch = due.flatMap((row) => byId.get(row.id) ?? []);

  /** Businesses whose endpoint did not answer, or failed slowly, in this run, with that outcome; their other deliveries are not sent. */
  const stopped = new Map<string, Outcome>();
  /** Time each business's deliveries took in this run. */
  const spent = new Map<string, number>();
  const alerted = new Set<string>();
  let next = 0;
  const lane = async () => {
    while (!signal.aborted && next < batch.length) {
      const delivery = batch[next++];
      try {
        const stop = stopped.get(delivery.merchantId);
        if (stop) {
          await failLikeSibling(delivery, stop, alerted);
          continue;
        }
        /** Over its time this run, the rest wait for the next run without counting an attempt. */
        if ((spent.get(delivery.merchantId) ?? 0) >= MERCHANT_RUN_BUDGET_MS) continue;
        const started = Date.now();
        const outcome = await sendDelivery(delivery, alerted);
        const took = Date.now() - started;
        spent.set(delivery.merchantId, (spent.get(delivery.merchantId) ?? 0) + took);
        const slowFailure = !outcome.ok && !outcome.unreachable && took >= SLOW_FAILURE_MS;
        if (slowFailure) await pauseEndpoint(delivery.merchantId);
        if (outcome.unreachable || slowFailure) stopped.set(delivery.merchantId, outcome);
      } catch (error) {
        log.error({ delivery: delivery.id, error: errorMessage(error) }, "Delivery failed");
        reportError(error, { job: "webhooks", delivery: delivery.id });
      }
    }
  };
  await Promise.all(Array.from({ length: LANES }, lane));
  return batch.length;
}
