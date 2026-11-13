import { authenticateMerchant } from "@/lib/api/auth";
import { ApiError, handleRoute } from "@/lib/api/errors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getDb } from "@/lib/db";
import { serializeInvoice } from "@/lib/invoices/serialize";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/invoices/[id]">) {
  return handleRoute(async () => {
    const { merchant, mode, apiKeyId } = await authenticateMerchant(request);
    /** Matches invoice creation and redeem: the x402 paywall reads the invoice once for every paid call. */
    await rateLimit(`invoice-read:${apiKeyId}`, 1200, 60_000);
    const { id } = await ctx.params;

    const invoice = await getDb().invoice.findFirst({ where: { id, merchantId: merchant.id, mode } });
    if (!invoice) throw new ApiError(404, "not_found", "No invoice with this id.", "id");
    return Response.json(serializeInvoice(invoice));
  });
}
