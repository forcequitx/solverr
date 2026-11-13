import { authenticateMerchant } from "@/lib/api/auth";
import { readJson } from "@/lib/api/body";
import { ApiError, handleRoute } from "@/lib/api/errors";
import { withIdempotency } from "@/lib/api/idempotency";
import { rateLimit } from "@/lib/api/rate-limit";
import { getDb } from "@/lib/db";
import { serializePayment } from "@/lib/payments/serialize";

/** Marks a paid invoice as used, once, so a paywall grants access a single time per payment; returns the paying transaction too. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/invoices/[id]/redeem">) {
  return handleRoute(async () => {
    const { merchant, mode, apiKeyId } = await authenticateMerchant(request);
    /** One redeem per paid x402 call, matching invoice creation. */
    await rateLimit(`redeem:${apiKeyId}`, 1200, 60_000);
    const { id } = await ctx.params;
    const { raw } = await readJson(request);
    const db = getDb();

    return withIdempotency(request, merchant.id, raw, async () => {
      const invoice = await db.invoice.findFirst({ where: { id, merchantId: merchant.id, mode }, select: { status: true, paidQuoteId: true, destinationChain: true } });
      if (!invoice) throw new ApiError(404, "not_found", "No invoice with this id.", "id");
      if (invoice.status !== "paid") throw new ApiError(409, "invalid_state", "This invoice is not paid yet.");
      /** Read before redeeming, so a failed read never leaves the invoice used without the caller learning it. */
      const quote = invoice.paidQuoteId
        ? await db.quote.findUnique({ where: { id: invoice.paidQuoteId }, include: { events: { orderBy: { receivedAt: "desc" }, take: 1 } } })
        : null;

      const redeemedAt = new Date();
      const updated = await db.invoice.updateMany({ where: { id, merchantId: merchant.id, status: "paid", redeemedAt: null }, data: { redeemedAt } });
      if (updated.count === 0) throw new ApiError(409, "already_redeemed", "This payment was already used.");
      const payment = quote ? serializePayment(quote, quote.events[0], invoice.destinationChain) : null;
      return { status: 200, body: { id, redeemed_at: redeemedAt.toISOString(), payment } };
    });
  });
}
