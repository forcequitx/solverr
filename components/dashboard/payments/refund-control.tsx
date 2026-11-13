import { RefundButton } from "@/components/dashboard/payments/refund-button";
import type { RefundCheck } from "@/lib/transfers/transfers";

/** The Refund button when `check` (from `checkRefund`) allows a refund of what is left; otherwise one line on why the server would refuse it. */
export function RefundControl({ check, invoiceId, paymentId, label }: { check: RefundCheck<unknown>; invoiceId: string; paymentId?: string; label?: string }) {
  if (check.ok) return <RefundButton invoiceId={invoiceId} paymentId={paymentId} label={label} />;
  return <p className="max-w-xs text-meta text-muted">{check.reason === "refunded" ? "This payment is refunded in full." : check.error.message}</p>;
}
