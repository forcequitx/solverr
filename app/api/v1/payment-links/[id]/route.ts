import { authenticateMerchant } from "@/lib/api/auth";
import { ApiError, handleRoute } from "@/lib/api/errors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getDb } from "@/lib/db";
import { serializePaymentLink } from "@/lib/payment-links/links";

/** Turns a payment link off; customers who open it see that it no longer exists. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/v1/payment-links/[id]">) {
  return handleRoute(async () => {
    const { merchant, mode, apiKeyId } = await authenticateMerchant(request);
    await rateLimit(`key:${apiKeyId}`, 60, 60_000);
    const { id } = await ctx.params;
    const db = getDb();
    const updated = await db.paymentLink.updateMany({ where: { id, merchantId: merchant.id, mode }, data: { active: false } });
    if (updated.count === 0) throw new ApiError(404, "not_found", "No payment link with this id.", "id");
    return Response.json(serializePaymentLink(await db.paymentLink.findUniqueOrThrow({ where: { id } })));
  });
}
