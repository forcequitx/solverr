import type { WebhookDelivery } from "@/generated/prisma/client";
import { Badge, type BadgeTone } from "@/components/ui/badge";

export type DeliveryStatus = WebhookDelivery["status"];

const STATUSES: Record<DeliveryStatus, [string, BadgeTone]> = { delivered: ["Delivered", "success"], failed: ["Failed", "danger"], pending: ["Pending", "muted"] };

/** A webhook delivery's status as a colored badge. */
export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  const [label, tone] = STATUSES[status];
  return <Badge tone={tone}>{label}</Badge>;
}

/** What the webhook URL answered, such as "HTTP 500", else the last connection error. */
export const deliveryResponse = (delivery: Pick<WebhookDelivery, "responseCode" | "lastError">) =>
  delivery.responseCode ? `HTTP ${delivery.responseCode}` : (delivery.lastError ?? "—");
