"use client";

import { useRouter } from "next/navigation";
import { useMerchantId } from "@/components/dashboard/dashboard-context";
import { useAction } from "@/components/dashboard/use-action";
import { ActionButton } from "@/components/ui/action-button";
import { ActionError } from "@/components/ui/action-error";
import { createRefundAction } from "@/lib/merchants/actions/transfers";

/** Creates a pending refund for one payment and opens its page, where the merchant sends it from their own wallet. */
export function RefundButton({ invoiceId, paymentId, label = "Refund" }: { invoiceId: string; paymentId?: string; label?: string }) {
  const router = useRouter();
  const merchantId = useMerchantId();
  /** The button stays busy until the refund page opens. */
  const { pending, error, failed, run } = useAction();
  return (
    <span className="flex flex-col items-end gap-1">
      <ActionButton
        size="sm"
        variant="danger"
        pending={pending}
        pendingLabel="Preparing…"
        failed={failed}
        onClick={() =>
          run(
            () => createRefundAction(merchantId, invoiceId, paymentId),
            (result) => router.push(`/dashboard/transfers/${result.id}`),
          )
        }
      >
        {label}
      </ActionButton>
      <ActionError message={error} className="max-w-xs text-right" />
    </span>
  );
}
