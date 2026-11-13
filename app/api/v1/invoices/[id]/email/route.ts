import { z } from "zod";
import { readJson } from "@/lib/api/body";
import { ApiError, handleRoute, parseInput } from "@/lib/api/errors";
import { clientIp, rateLimit } from "@/lib/api/rate-limit";
import { getDb } from "@/lib/db";
import { emailEnabled } from "@/lib/email/send";
import { receiptStillSent } from "@/lib/payments/receipts";

const schema = z.strictObject({ email: z.email({ error: "Enter a valid email address." }).max(200) });

/** Public: the customer asks for a receipt email; it is sent once the invoice is paid. Only sets an email that is still empty. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/invoices/[id]/email">) {
  return handleRoute(async () => {
    const { id } = await ctx.params;
    await rateLimit(`receipt-email-ip:${clientIp(request)}`, 5, 60_000);
    if (!emailEnabled()) throw new ApiError(409, "invalid_state", "Receipt emails are not available.");
    const { email } = parseInput(schema, (await readJson(request)).data);
    const db = getDb();
    const invoice = await db.invoice.findUnique({ where: { id }, select: { mode: true, status: true, paidAt: true } });
    if (!invoice) throw new ApiError(404, "not_found", "No invoice with this id.", "id");
    /** Test mode (the demo store) emails no customer, nor does a payment paid too long ago, matching the checkout's `email_receipts` flag. */
    if (invoice.mode !== "live" || !receiptStillSent(invoice)) throw new ApiError(409, "invalid_state", "Receipt emails are not available.");
    const updated = await db.invoice.updateMany({ where: { id, customerEmail: null }, data: { customerEmail: email } });
    if (updated.count === 0) throw new ApiError(409, "invalid_state", "A receipt email is already set for this payment.");
    return new Response(null, { status: 204 });
  });
}
