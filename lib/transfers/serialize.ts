import type { Transfer } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";

/** The public shape of a refund or payout, as the API and webhooks return it. */
export function serializeTransfer(transfer: Transfer) {
  return {
    id: transfer.id,
    object: transfer.kind,
    status: transfer.status,
    invoice_id: transfer.invoiceId,
    batch_id: transfer.batchId,
    amount: transfer.amount,
    source_asset: transfer.sourceAsset,
    asset_id: transfer.destinationAsset,
    recipient: transfer.recipient,
    tx_hash: transfer.txHash,
    failure_reason: transfer.failureReason,
    sign_url: new URL(`/dashboard/transfers/${transfer.id}`, getEnv().APP_URL).toString(),
    created_at: transfer.createdAt.toISOString(),
  };
}
