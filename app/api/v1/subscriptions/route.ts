import { authenticateMerchant } from "@/lib/api/auth";
import { readJson } from "@/lib/api/body";
import { handleRoute, parseInput } from "@/lib/api/errors";
import { withIdempotency } from "@/lib/api/idempotency";
import { afterCursor, CURSOR_SELECT, listQuerySchema, listResponse, pageArgs } from "@/lib/api/list";
import { rateLimit } from "@/lib/api/rate-limit";
import { getDb } from "@/lib/db";
import { createSubscription, createSubscriptionSchema, serializeSubscription } from "@/lib/subscriptions/subscriptions";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const { merchant, apiKeyId } = await authenticateMerchant(request);
    await rateLimit(`key:${apiKeyId}`, 60, 60_000);
    const { raw, data } = await readJson(request);
    return withIdempotency(request, merchant.id, raw, async () => ({
      status: 201,
      body: serializeSubscription(await createSubscription(merchant, parseInput(createSubscriptionSchema, data))),
    }));
  });
}

export async function GET(request: Request) {
  return handleRoute(async () => {
    const { merchant, apiKeyId } = await authenticateMerchant(request);
    await rateLimit(`key:${apiKeyId}`, 60, 60_000);
    const query = parseInput(listQuerySchema, Object.fromEntries(new URL(request.url).searchParams));
    const db = getDb();
    const where = { merchantId: merchant.id };
    const cursor = query.starting_after ? await db.subscription.findFirst({ where: { ...where, id: query.starting_after }, select: CURSOR_SELECT }) : null;
    const rows = await db.subscription.findMany({ where: { ...where, ...afterCursor(cursor, query) }, ...pageArgs(query) });
    return Response.json(listResponse(rows, query, serializeSubscription));
  });
}
