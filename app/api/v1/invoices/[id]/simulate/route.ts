import { readJson } from "@/lib/api/body";
import { handleRoute, parseInput } from "@/lib/api/errors";
import { clientIp, rateLimit } from "@/lib/api/rate-limit";
import { simulatePayment, simulateSchema } from "@/lib/payments/deposit";

/** Public, test invoices only: drives the Simulate panel on the checkout page. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/invoices/[id]/simulate">) {
  return handleRoute(async () => {
    const { id } = await ctx.params;
    /** Test mode only; generous so a room of people trying the demo on one Wi-Fi network is never refused. */
    await rateLimit(`simulate-ip:${clientIp(request)}`, 60, 60_000);
    const input = parseInput(simulateSchema, (await readJson(request)).data);
    await simulatePayment(id, input.outcome);
    return new Response(null, { status: 204 });
  });
}
