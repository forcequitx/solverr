import { readJson } from "@/lib/api/body";
import { handleRoute, parseInput } from "@/lib/api/errors";
import { clientIp, clientNetwork, rateLimit } from "@/lib/api/rate-limit";
import { serializeInvoice } from "@/lib/invoices/serialize";
import { invoiceForLink, payLinkSchema } from "@/lib/payment-links/links";

/** Public: a customer opening a payment link gets a new invoice to pay. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/payment-links/[id]/invoices">) {
  return handleRoute(async () => {
    const { id } = await ctx.params;
    /** Sized for one venue's Wi-Fi or a carrier NAT where many customers scan the same QR code; the per-link cap bounds the rest. */
    await rateLimit(`link-ip:${clientIp(request)}`, 60, 60_000);
    await rateLimit(`link-net:${clientNetwork(request)}`, 240, 60_000);
    /** A ceiling far above one network's limit, so a few clients cannot close a popular link to everyone else. */
    await rateLimit(`link-visits:${id}`, 600, 60_000);
    const input = parseInput(payLinkSchema, (await readJson(request)).data);
    const invoice = await invoiceForLink(id, input.amount);
    const { id: invoiceId, checkout_url, status } = serializeInvoice(invoice);
    return Response.json({ id: invoiceId, status, checkout_url }, { status: 201 });
  });
}
