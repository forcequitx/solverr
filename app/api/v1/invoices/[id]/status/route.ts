import { ApiError, handleRoute, NO_STORE } from "@/lib/api/errors";
import { clientIp, clientNetwork, rateLimit } from "@/lib/api/rate-limit";
import { getCheckoutState } from "@/lib/payments/checkout-state";

/** Public: the checkout page polls this for live payment status. */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/invoices/[id]/status">) {
  return handleRoute(async () => {
    const { id } = await ctx.params;
    /** A cheap indexed read polled by open checkouts and agents; generous so venue Wi-Fi and mobile carrier NAT never trip it. */
    await rateLimit(`status-ip:${clientIp(request)}`, 600, 60_000);
    await rateLimit(`status-net:${clientNetwork(request)}`, 1200, 60_000);
    const state = await getCheckoutState(id);
    if (!state) throw new ApiError(404, "not_found", "No invoice with this id.", "id");
    return Response.json(state, { headers: NO_STORE });
  });
}
