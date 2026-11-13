import type { TransferKind } from "@/generated/prisma/client";

/** A split payout shrunk to nothing while a refund of its payment is open: it is resized when the refund ends (paid if the refund fails,
    canceled if it completes), so it can be neither sent nor canceled meanwhile. */
export const SPLIT_ON_HOLD = "This split payout is on hold while a refund of its payment is open. It is paid if the refund fails, and canceled if it completes.";

export function splitOnHold(transfer: { splitShareBps: number | null; status: string; amount: string }): boolean {
  return transfer.splitShareBps !== null && transfer.status === "pending" && Number(transfer.amount) === 0;
}

/** Plain names for each kind of transfer, as merchants see them in the dashboard and alerts. */
export const KIND_LABELS: Record<TransferKind, string> = { refund: "Refund", payout: "Payout", withdrawal: "Earn withdrawal" };
