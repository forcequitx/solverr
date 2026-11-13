import { authenticateMerchant } from "@/lib/api/auth";
import { ApiError, handleRoute } from "@/lib/api/errors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getDb } from "@/lib/db";
import { serializeSubscription } from "@/lib/subscriptions/subscriptions";

/** Cancels a subscription; no further invoices are created for it. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/v1/subscriptions/[id]">) {
  return handleRoute(async () => {
    const { merchant, apiKeyId } = await authenticateMerchant(request);
    await rateLimit(`key:${apiKeyId}`, 60, 60_000);
    const { id } = await ctx.params;
    const db = getDb();
    const updated = await db.subscription.updateMany({ where: { id, merchantId: merchant.id }, data: { status: "canceled" } });
    if (updated.count === 0) throw new ApiError(404, "not_found", "No subscription with this id.", "id");
    return Response.json(serializeSubscription(await db.subscription.findUniqueOrThrow({ where: { id } })));
  });
}
