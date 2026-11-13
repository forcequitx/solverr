import { getDb } from "@/lib/db";

/** `service_health` row the worker refreshes while it runs. */
const WORKER_SERVICE_ID = "worker";
/** How often the worker records that it is running. */
export const HEARTBEAT_MS = 30_000;
/** A heartbeat older than this means the worker stopped or hangs. */
const STALE_AFTER_MS = 4 * HEARTBEAT_MS;

/** Worker job: records that the worker runs; any critical job named in `stalled` (no recent success) makes it count as unhealthy. */
export async function recordWorkerHeartbeat(stalled: readonly string[]): Promise<void> {
  const checkedAt = new Date();
  const healthy = stalled.length === 0;
  await getDb().serviceHealth.upsert({
    where: { id: WORKER_SERVICE_ID },
    create: { id: WORKER_SERVICE_ID, healthy, checkedAt },
    update: { healthy, checkedAt },
  });
}

/** Whether the worker recorded a heartbeat within STALE_AFTER_MS, with every critical job working. */
export async function workerAlive(): Promise<boolean> {
  const row = await getDb().serviceHealth.findUnique({ where: { id: WORKER_SERVICE_ID }, select: { checkedAt: true, healthy: true } });
  return !!row && row.healthy && Date.now() - row.checkedAt.getTime() < STALE_AFTER_MS;
}
