import { ApiError, handleRoute, NO_STORE, parseInput } from "@/lib/api/errors";
import { clientIp, rateLimit } from "@/lib/api/rate-limit";
import { getDb } from "@/lib/db";
import { getCheckoutState } from "@/lib/payments/checkout-state";
import { findInvoiceId, lookupSchema } from "@/lib/support/cases";

/** Public: the help page finds a payment by invoice id or transaction hash; a hash is public on chain, so a match by hash returns only the status. */
export async function GET(request: Request) {
  return handleRoute(async () => {
    await rateLimit(`lookup-ip:${clientIp(request)}`, 30, 60_000);
    const input = parseInput(lookupSchema, Object.fromEntries(new URL(request.url).searchParams));
    const match = await findInvoiceId(input);
    if (match?.matchedBy === "tx_hash") {
      const invoice = await getDb().invoice.findUnique({ where: { id: match.invoiceId }, select: { status: true } });
      if (invoice) return Response.json({ object: "payment_lookup", status: invoice.status }, { headers: NO_STORE });
    }
    const state = match?.matchedBy === "invoice_id" ? await getCheckoutState(match.invoiceId, { markSeen: false }) : undefined;
    if (!state) throw new ApiError(404, "not_found", "No payment matches this. Check the payment ID or transaction hash, or open a support case.");
    return Response.json(state, { headers: NO_STORE });
  });
}
