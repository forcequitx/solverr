import type { Invoice } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";
import { formatBaseUnits } from "@/lib/money";

/** Public API shape of an invoice. */
export function serializeInvoice(invoice: Invoice) {
  const appUrl = getEnv().APP_URL;
  return {
    id: invoice.id,
    object: "invoice",
    mode: invoice.mode,
    status: invoice.status,
    amount: invoice.amount.toFixed(2),
    currency: invoice.currency,
    order_id: invoice.orderId,
    description: invoice.description,
    customer_email: invoice.customerEmail,
    redirect_url: invoice.redirectUrl,
    metadata: invoice.metadata ?? {},
    settlement: {
      asset_id: invoice.destinationAsset,
      symbol: invoice.destinationSymbol,
      blockchain: invoice.destinationChain,
      amount: formatBaseUnits(BigInt(invoice.amountOutBase), invoice.destinationDecimals),
      amount_base: invoice.amountOutBase,
    },
    late: invoice.late,
    extra_payment: invoice.extraPayment,
    checkout_url: new URL(`/pay/${invoice.id}`, appUrl).toString(),
    receipt_url: invoice.status === "paid" ? new URL(`/receipt/${invoice.id}`, appUrl).toString() : null,
    /** When a paywall used this payment (`POST /api/v1/invoices/:id/redeem`); a used payment cannot unlock anything again. */
    redeemed_at: invoice.redeemedAt?.toISOString() ?? null,
    expires_at: invoice.expiresAt.toISOString(),
    created_at: invoice.createdAt.toISOString(),
  };
}
