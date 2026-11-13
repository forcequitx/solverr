import type { OneClickStatus } from "@/generated/prisma/client";

/** Plain names for NEAR Intents (1Click) payment statuses, as merchants see them in the dashboard. */
const ONECLICK_STATUS_LABELS: Record<OneClickStatus, string> = {
  PENDING_DEPOSIT: "Waiting for deposit",
  KNOWN_DEPOSIT_TX: "Deposit seen",
  INCOMPLETE_DEPOSIT: "Deposit too low",
  PROCESSING: "Converting",
  SUCCESS: "Delivered",
  REFUNDED: "Refunded",
  FAILED: "Failed",
};

export const oneClickStatusLabel = (status: string) => ONECLICK_STATUS_LABELS[status as OneClickStatus] ?? status.toLowerCase().replace(/_/g, " ");
