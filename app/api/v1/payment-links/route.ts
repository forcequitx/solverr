import { authenticateMerchant } from "@/lib/api/auth";
import { readJson } from "@/lib/api/body";
import { handleRoute, parseInput } from "@/lib/api/errors";
import { withIdempotency } from "@/lib/api/idempotency";
import { afterCursor, CURSOR_SELECT, listQuerySchema, listResponse, pageArgs } from "@/lib/api/list";
import { rateLimit } from "@/lib/api/rate-limit";
import { getDb } from "@/lib/db";
import { createPaymentLink, createPaymentLinkSchema, serializePaymentLink } from "@/lib/payment-links/links";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const { merchant, mode, apiKeyId } = await authenticateMerchant(request);
    await rateLimit(`key:${apiKeyId}`, 60, 60_000);
    const { raw, data } = await readJson(request);
    return withIdempotency(request, merchant.id, raw, async () => {
      const link = await createPaymentLink(merchant, mode, parseInput(createPaymentLinkSchema, data));
      return { status: 201, body: serializePaymentLink(link) };
    });
  });
}

export async function GET(request: Request) {
  return handleRoute(async () => {
    const { merchant, mode, apiKeyId } = await authenticateMerchant(request);
    await rateLimit(`key:${apiKeyId}`, 60, 60_000);
    const query = parseInput(listQuerySchema, Object.fromEntries(new URL(request.url).searchParams));
    const db = getDb();
    const where = { merchantId: merchant.id, mode };
    const cursor = query.starting_after ? await db.paymentLink.findFirst({ where: { ...where, id: query.starting_after }, select: CURSOR_SELECT }) : null;
    const rows = await db.paymentLink.findMany({ where: { ...where, ...afterCursor(cursor, query) }, ...pageArgs(query) });
    return Response.json(listResponse(rows, query, serializePaymentLink));
  });
}
