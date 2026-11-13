import { NO_STORE } from "@/lib/api/errors";
import { databaseReachable } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Liveness probe: 200 when the server can reach the database, 503 otherwise. */
export async function GET() {
  if (!(await databaseReachable())) return Response.json({ ok: false }, { status: 503, headers: NO_STORE });
  return Response.json({ ok: true }, { headers: NO_STORE });
}
