import type { TransferStatus } from "@/generated/prisma/client";
import { Badge, type BadgeTone } from "@/components/ui/badge";

export const STATUS_LABELS: Record<TransferStatus, string> = { pending: "Waiting for approval", processing: "Sending", completed: "Completed", failed: "Failed", canceled: "Canceled" };

const TONES: Record<TransferStatus, BadgeTone> = { pending: "warn", processing: "info", completed: "success", failed: "danger", canceled: "muted" };

export function TransferStatusBadge({ status }: { status: TransferStatus }) {
  return <Badge tone={TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}
