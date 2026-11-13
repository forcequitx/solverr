import type { TransferKind } from "@/generated/prisma/client";
import { authenticateMerchant } from "@/lib/api/auth";
import { readJson } from "@/lib/api/body";
import { ApiError, handleRoute, parseInput } from "@/lib/api/errors";
import { withIdempotency } from "@/lib/api/idempotency";
import { afterCursor, CURSOR_SELECT, listQuerySchema, listResponse, pageArgs } from "@/lib/api/list";
import { rateLimit } from "@/lib/api/rate-limit";
import { getDb } from "@/lib/db";
import { cancelTransfer } from "@/lib/transfers/execute";
import { serializeTransfer } from "@/lib/transfers/serialize";

type TransferContext = { params: Promise<{ id: string }> };

/** Shared `GET` handler for `/api/v1/refunds` and `/api/v1/payouts`. */
export function listTransfers(kind: TransferKind) {
  return (request: Request) =>
    handleRoute(async () => {
      const { merchant, apiKeyId } = await authenticateMerchant(request);
      await rateLimit(`key:${apiKeyId}`, 60, 60_000);
      const query = parseInput(listQuerySchema, Object.fromEntries(new URL(request.url).searchParams));
      const db = getDb();
      const where = { merchantId: merchant.id, kind };
      const cursor = query.starting_after ? await db.transfer.findFirst({ where: { ...where, id: query.starting_after }, select: CURSOR_SELECT }) : null;
      const rows = await db.transfer.findMany({ where: { ...where, ...afterCursor(cursor, query) }, ...pageArgs(query) });
      return Response.json(listResponse(rows, query, serializeTransfer));
    });
}

/** The merchant's transfer of `kind` with this id, or a 404 that does not tell whether another business has one. */
async function findTransfer(kind: TransferKind, merchantId: string, id: string) {
  const transfer = await getDb().transfer.findFirst({ where: { id, merchantId, kind } });
  if (!transfer) throw new ApiError(404, "not_found", `No ${kind} with this id.`, "id");
  return transfer;
}

/** Shared `GET` handler for `/api/v1/refunds/:id` and `/api/v1/payouts/:id`. */
export function getTransfer(kind: TransferKind) {
  return (request: Request, ctx: TransferContext) =>
    handleRoute(async () => {
      const { merchant, apiKeyId } = await authenticateMerchant(request);
      await rateLimit(`key:${apiKeyId}`, 60, 60_000);
      const { id } = await ctx.params;
      return Response.json(serializeTransfer(await findTransfer(kind, merchant.id, id)));
    });
}

/** Shared `POST` handler for `/api/v1/refunds/:id/cancel` and `/api/v1/payouts/:id/cancel`. */
export function cancelTransferRoute(kind: TransferKind) {
  return (request: Request, ctx: TransferContext) =>
    handleRoute(async () => {
      const { merchant, apiKeyId } = await authenticateMerchant(request);
      await rateLimit(`key:${apiKeyId}`, 60, 60_000);
      const { id } = await ctx.params;
      const { raw } = await readJson(request);
      return withIdempotency(request, merchant.id, raw, async () => {
        const transfer = await findTransfer(kind, merchant.id, id);
        return { status: 200, body: serializeTransfer(await cancelTransfer(transfer.id, merchant.id)) };
      });
    });
}
