import type { Merchant, Mode } from "@/generated/prisma/client";
import { DAY_MS } from "@/lib/time";

/** The merchant columns that hold the business's webhook endpoint. */
export type WebhookColumns = Pick<Merchant, "webhookUrl" | "webhookSecretEnc" | "webhookPreviousSecretEnc" | "webhookPreviousSecretUntil" | "webhookDisabledAt">;

/** How long the secret replaced by a rotation keeps signing deliveries beside the new one. */
export const ROTATION_OVERLAP_MS = DAY_MS;

export const WEBHOOKS_OFF_MESSAGE = "Webhooks are off because the endpoint answered 410 Gone. Save the webhook URL again to turn them back on.";

/** The URL and encrypted signing secrets; `secretsEnc` lists the current secret first, then a rotated one still in its overlap. */
type WebhookEndpoint = { url: string; secretsEnc: string[] };

/** The endpoint for `mode` events, or null: test mode (demo store) has none, and one that answered 410 Gone stays off until saved again. */
export function webhookEndpoint(merchant: WebhookColumns, mode: Mode): WebhookEndpoint | null {
  if (mode !== "live" || merchant.webhookDisabledAt) return null;
  const { webhookUrl: url, webhookSecretEnc: secretEnc, webhookPreviousSecretEnc: previousEnc, webhookPreviousSecretUntil: previousUntil } = merchant;
  if (!url || !secretEnc) return null;
  const overlapping = previousEnc && previousUntil && previousUntil.getTime() > Date.now();
  return { url, secretsEnc: overlapping ? [secretEnc, previousEnc] : [secretEnc] };
}
