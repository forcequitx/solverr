import { NO_STORE } from "@/lib/api/errors";
import { workerAlive } from "@/lib/worker/heartbeat";

export const dynamic = "force-dynamic";

/** Uptime-monitor probe: 200 when the database answers and the worker's heartbeat is fresh with every critical job working; 503 otherwise. */
export async function GET() {
  const alive = await workerAlive().catch(() => false);
  return Response.json({ ok: alive }, { status: alive ? 200 : 503, headers: NO_STORE });
}
