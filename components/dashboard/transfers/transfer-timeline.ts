import type { Transfer } from "@/generated/prisma/client";
import type { TimelineStep } from "@/components/dashboard/detail/status-timeline";
import { formatUtcDateTime } from "@/lib/format";
import { oneClickStatusLabel } from "@/lib/oneclick/status-labels";

/** Steps of a refund, payout or Earn withdrawal: prepared, approved, converted when coins differ, result; `recipientGets` is e.g. "USDT on TRON". */
export function transferTimeline(transfer: Transfer, { converted, recipientGets }: { converted: boolean; recipientGets: string }): TimelineStep[] {
  const prepared: TimelineStep = { id: "prepared", label: "Prepared by Solverr", time: formatUtcDateTime(transfer.createdAt), state: "done" };
  if (transfer.status === "canceled") {
    return [prepared, { id: "canceled", label: "Canceled", detail: "The transfer was canceled before it was sent.", time: formatUtcDateTime(transfer.updatedAt), state: "warn" }];
  }
  const sent = transfer.status !== "pending";
  const steps: TimelineStep[] = [
    prepared,
    sent
      ? { id: "approved", label: "Sent from your wallet", state: "done" }
      : { id: "approved", label: "Waiting for your approval", detail: "Connect your payout wallet and send the transfer below.", state: "current" },
  ];

  if (transfer.status === "failed") {
    return [...steps, { id: "failed", label: "Failed", detail: transfer.failureReason ?? "The transfer did not complete.", time: formatUtcDateTime(transfer.updatedAt), state: "failed" }];
  }
  if (converted) {
    steps.push({
      id: "converting",
      label: "Converting through NEAR Intents",
      detail: transfer.status === "processing" && transfer.oneclickStatus ? `NEAR Intents status: ${oneClickStatusLabel(transfer.oneclickStatus)}.` : `The coins are swapped to ${recipientGets}.`,
      state: transfer.status === "completed" ? "done" : transfer.status === "processing" ? "current" : "upcoming",
    });
  }
  const completed = transfer.status === "completed";
  /** A completed transfer is not updated again, so its updatedAt is when it completed. */
  steps.push({ id: "completed", label: "Completed", detail: `The recipient ${completed ? "got" : "gets"} ${recipientGets}.`, time: completed ? formatUtcDateTime(transfer.updatedAt) : undefined, state: completed ? "done" : "upcoming" });
  return steps;
}
