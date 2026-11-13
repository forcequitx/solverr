import type { Mode, Prisma } from "@/generated/prisma/client";
import { newId } from "@/lib/ids";
import { webhookEndpoint, type WebhookColumns } from "@/lib/webhooks/endpoint";

export type WebhookEventType =
  | "invoice.detected"
  | "invoice.paid"
  | "invoice.underpaid"
  | "invoice.refunded"
  | "invoice.failed"
  | "invoice.expired"
  | "invoice.extra_payment"
  | "refund.completed"
  | "refund.failed"
  | "refund.canceled"
  | "payout.completed"
  | "payout.failed"
  | "payout.canceled"
  | "subscription.invoice_created"
  | "support_case.created"
  | "test.ping";

/** Queues a webhook event for delivery by the worker; nothing is queued while `mode` has no webhook endpoint, so every
    stored delivery is a live one (test mode, the demo store, has none). */
export async function enqueueWebhook(
  tx: Prisma.TransactionClient,
  merchant: { id: string } & WebhookColumns,
  mode: Mode,
  type: WebhookEventType,
  data: Prisma.InputJsonObject,
): Promise<void> {
  if (!webhookEndpoint(merchant, mode)) return;
  const id = newId("evt");
  await tx.webhookDelivery.create({
    data: {
      id,
      merchantId: merchant.id,
      eventType: type,
      payload: { id, type, mode, created_at: new Date().toISOString(), data },
    },
  });
}
