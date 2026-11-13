import { readJson } from "@/lib/api/body";
import { handleRoute, parseInput } from "@/lib/api/errors";
import { clientIp, clientNetwork, rateLimit } from "@/lib/api/rate-limit";
import { estimatePayments, estimateSchema } from "@/lib/payments/estimate";

/** Dry quotes one address, and one network, may request per minute; each coin in a request counts as one. */
const QUOTES_PER_IP = 25;
const QUOTES_PER_NETWORK = 100;

/** Public: the checkout ranks the coins a connected wallet holds by what the payment would cost in each. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/invoices/[id]/estimate">) {
  return handleRoute(async () => {
    const { id } = await ctx.params;
    /** Client limits count every request first (malformed ones and unknown ids too), then each further coin in the body.
        The invoice's own limit comes last and is counted per client network, so others cannot use it up for its payer. */
    await rateLimit(`estimate-ip:${clientIp(request)}`, QUOTES_PER_IP, 60_000);
    await rateLimit(`estimate-net:${clientNetwork(request)}`, QUOTES_PER_NETWORK, 60_000);
    const input = parseInput(estimateSchema, (await readJson(request)).data);
    const extraCoins = new Set(input.origin_assets).size - 1;
    if (extraCoins > 0) {
      await rateLimit(`estimate-ip:${clientIp(request)}`, QUOTES_PER_IP, 60_000, extraCoins);
      await rateLimit(`estimate-net:${clientNetwork(request)}`, QUOTES_PER_NETWORK, 60_000, extraCoins);
    }
    await rateLimit(`estimate-invoice:${id}:${clientNetwork(request)}`, 10, 60_000);
    return Response.json({ object: "list", data: await estimatePayments(id, input) });
  });
}
