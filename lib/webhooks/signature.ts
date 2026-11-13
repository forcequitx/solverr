import { createHmac, randomBytes } from "node:crypto";

/** Standard Webhooks headers (standardwebhooks.com) that identify and sign every event. */
const STANDARD_HEADERS = { id: "webhook-id", timestamp: "webhook-timestamp", signature: "webhook-signature" } as const;

const SECRET_PREFIX = "whsec_";
/** Random bytes in a new signing secret; Standard Webhooks allows 24 to 64. */
const SECRET_BYTES = 24;

/** A new signing secret: `whsec_` and standard base64, the format Standard Webhooks libraries expect. */
export function newWebhookSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(SECRET_BYTES).toString("base64")}`;
}

/** Standard Webhooks `v1` signature: base64 HMAC-SHA256 of `id.timestamp.body`, keyed with the base64-decoded secret after `whsec_`. */
function sign(secret: string, id: string, timestamp: number, body: string): string {
  const key = Buffer.from(secret.slice(SECRET_PREFIX.length), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

/** Headers that identify and sign one delivery; `secrets` is current first, then a rotated one, giving one `v1` signature per secret. */
export function signedHeaders(secrets: readonly string[], id: string, timestamp: number, body: string): Record<string, string> {
  return {
    [STANDARD_HEADERS.id]: id,
    [STANDARD_HEADERS.timestamp]: String(timestamp),
    [STANDARD_HEADERS.signature]: secrets.map((secret) => sign(secret, id, timestamp, body)).join(" "),
  };
}
