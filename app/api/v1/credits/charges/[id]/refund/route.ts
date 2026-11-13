import { authenticateMerchant } from "@/lib/api/auth";
import { readJson } from "@/lib/api/body";
import { handleRoute } from "@/lib/api/errors";
import { withIdempotency } from "@/lib/api/idempotency";
import { rateLimit } from "@/lib/api/rate-limit";
import { refundCharge } from "@/lib/credits/credits";

/** Paywall middleware gives a credit charge back when the request it paid for failed. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/credits/charges/[id]/refund">) {
  return handleRoute(async () => {
    const { merchant, apiKeyId } = await authenticateMerchant(request);
    /** Its own bucket, so refunds after failed requests never use up the budget for new charges. */
    await rateLimit(`credit-refunds:${apiKeyId}`, 600, 60_000);
    const { id } = await ctx.params;
    const { raw } = await readJson(request);
    return withIdempotency(request, merchant.id, raw, async () => ({ status: 200, body: await refundCharge(merchant, id) }));
  });
}
