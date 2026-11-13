"use client";

import { ConfirmAction } from "@/components/dashboard/confirm-action";
import { useMerchantId } from "@/components/dashboard/dashboard-context";
import { useAction } from "@/components/dashboard/use-action";
import { cancelTransferAction } from "@/lib/merchants/actions/transfers";

/** Cancels an unsent transfer, warning that a prepared one may already be sent; the cancel carries this page's `depositAddress`,
    so a transfer prepared again from another page meanwhile is refused. */
export function CancelTransfer({ transferId, depositAddress }: { transferId: string; depositAddress: string | null }) {
  const merchantId = useMerchantId();
  const { pending, error, run } = useAction();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-line px-4 py-3">
      <p className="min-w-0 flex-1 text-sm text-muted">
        {depositAddress !== null
          ? "Cancel only if your wallet did not send this transfer; once canceled, it cannot be recorded."
          : "Not sending this transfer? Cancel it instead of leaving it open."}
      </p>
      <ConfirmAction
        label="Cancel transfer"
        confirmLabel="Cancel it"
        ariaLabel="Cancel this transfer"
        pending={pending}
        error={error}
        onConfirm={() => run(() => cancelTransferAction(merchantId, transferId, depositAddress))}
      />
    </div>
  );
}
