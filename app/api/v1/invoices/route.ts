import { z } from "zod";
import { InvoiceStatus } from "@/generated/prisma/client";
import { authenticateMerchant } from "@/lib/api/auth";
import { readJson } from "@/lib/api/body";
import { handleRoute, parseInput } from "@/lib/api/errors";
import { withIdempotency } from "@/lib/api/idempotency";
import { afterCursor, CURSOR_SELECT, listQuerySchema, listResponse, pageArgs } from "@/lib/api/list";
import { rateLimit } from "@/lib/api/rate-limit";
import { getDb } from "@/lib/db";
import { createInvoice } from "@/lib/invoices/create";
import { createInvoiceSchema } from "@/lib/invoices/schema";
import { serializeInvoice } from "@/lib/invoices/serialize";

const listInvoicesSchema = listQuerySchema.extend({ status: z.enum(InvoiceStatus).optional() });
const API_LIMIT = { requests: 60, windowMs: 60_000 };
/** Invoice creation has its own bucket so x402 challenges cannot use up the shared API key limit; every paid x402 call creates one. */
const CREATE_LIMIT = { requests: 1200, windowMs: 60_000 };

export async function POST(request: Request) {
  return handleRoute(async () => {
    const { merchant, mode, apiKeyId } = await authenticateMerchant(request);
    await rateLimit(`invoices:${apiKeyId}`, CREATE_LIMIT.requests, CREATE_LIMIT.windowMs);
    const { raw, data } = await readJson(request);

    return withIdempotency(request, merchant.id, raw, async () => {
      const input = parseInput(createInvoiceSchema, data);
      const invoice = await createInvoice(merchant, mode, input);
      return { status: 201, body: serializeInvoice(invoice) };
    });
  });
}

export async function GET(request: Request) {
  return handleRoute(async () => {
    const { merchant, mode, apiKeyId } = await authenticateMerchant(request);
    await rateLimit(`key:${apiKeyId}`, API_LIMIT.requests, API_LIMIT.windowMs);
    const query = parseInput(listInvoicesSchema, Object.fromEntries(new URL(request.url).searchParams));
    const db = getDb();
    const where = { merchantId: merchant.id, mode };
    const cursor = query.starting_after ? await db.invoice.findFirst({ where: { ...where, id: query.starting_after }, select: CURSOR_SELECT }) : null;
    const rows = await db.invoice.findMany({
      where: { ...where, ...(query.status ? { status: query.status } : {}), ...afterCursor(cursor, query) },
      ...pageArgs(query),
    });
    return Response.json(listResponse(rows, query, serializeInvoice));
  });
}
