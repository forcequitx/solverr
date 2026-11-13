import { readJson } from "@/lib/api/body";
import { handleRoute, parseInput } from "@/lib/api/errors";
import { clientIp, clientNetwork, rateLimit } from "@/lib/api/rate-limit";
import { createQuote, createQuoteSchema } from "@/lib/payments/quote";
import { serializePayment } from "@/lib/payments/serialize";

/** Public: the checkout page asks for a deposit address for the chosen coin. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/invoices/[id]/quote">) {
  return handleRoute(async () => {
    const { id } = await ctx.params;
    /** An agent server paying many x402 resources asks for many addresses; one IP or IPv6 /48 still gets at most 120 a minute, two fifths of one
        process's 1Click budget. */
    await rateLimit(`quote-ip:${clientIp(request)}`, 120, 60_000);
    await rateLimit(`quote-net:${clientNetwork(request)}`, 120, 60_000);
    /** Per client network too, so someone who has the link cannot use up the payer's attempts; createQuote also limits each business. */
    await rateLimit(`quote-invoice:${id}:${clientNetwork(request)}`, 10, 60_000);
    const input = parseInput(createQuoteSchema, (await readJson(request)).data);
    const { quote, destinationChain } = await createQuote(id, input);
    return Response.json(serializePayment(quote, null, destinationChain), { status: 201 });
  });
}
