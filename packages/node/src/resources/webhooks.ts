import { createHmac, timingSafeEqual } from "node:crypto";
import { WEBHOOK_HEADERS, WEBHOOK_SECRET_MIN_BYTES, WEBHOOK_SECRET_PREFIX, WEBHOOK_TOLERANCE_SECONDS } from "../config.js";
import { WebhookVerificationError } from "../errors.js";
import type { HttpClient } from "../http.js";
import type { WebhookEvent, WebhookTest } from "../types.js";

/** Request headers as a `Headers` instance or a plain object with any key casing (Node, Express). */
export type WebhookHeaders = Headers | Record<string, string | string[] | undefined>;

export interface WebhookVerifyOptions {
  /** Largest allowed gap between the signed timestamp and now, in seconds. */
  toleranceSeconds?: number;
}

const TIMESTAMP_PATTERN = /^\d{1,12}$/;
const SIGNATURE_VERSION = "v1,";
/** Standard base64 with optional padding; Node's decoder would otherwise skip unknown characters and accept URL-safe ones. */
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?)?$/;

/** The HMAC key of a `whsec_` secret: the standard base64 after the prefix, decoded, and long enough to be a real secret. */
function secretKey(secret: string): Buffer {
  const encoded = secret.slice(WEBHOOK_SECRET_PREFIX.length);
  const key = BASE64_PATTERN.test(encoded) ? Buffer.from(encoded, "base64") : undefined;
  if (!key || key.length < WEBHOOK_SECRET_MIN_BYTES) {
    throw new WebhookVerificationError(`The webhook secret must be whsec_ followed by at least ${WEBHOOK_SECRET_MIN_BYTES} bytes in standard base64.`);
  }
  return key;
}

function readHeader(headers: WebhookHeaders, name: string): string | undefined {
  if (typeof headers.get === "function") return (headers as Headers).get(name) ?? undefined;
  for (const [key, value] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (key.toLowerCase() !== name) continue;
    if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
    return value;
  }
  return undefined;
}

/** Verifies webhook events; `new Webhooks()` without a client is enough for that. `solverr.webhooks` also sends ping events. */
export class Webhooks {
  readonly #http: HttpClient | undefined;

  constructor(http?: HttpClient) {
    this.#http = http;
  }

  /** Queues a signed `test.ping` event to the business's webhook URL. Fails with 409 when no webhook URL is set. */
  async sendTest(): Promise<WebhookTest> {
    if (!this.#http) throw new TypeError("sendTest needs an API key: call it as solverr.webhooks.sendTest() on a Solverr client.");
    return this.#http.request({ method: "POST", path: "/api/v1/webhooks/test" });
  }

  /** Checks the Standard Webhooks signature (any `v1` entry may match) and the `webhook-timestamp` age, then returns the parsed event.
      Pass the raw request body exactly as received; re-serialized JSON will not match. */
  verify(rawBody: string | Uint8Array, headers: WebhookHeaders, secret: string, options: WebhookVerifyOptions = {}): WebhookEvent {
    const toleranceSeconds = options.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
    if (!Number.isSafeInteger(toleranceSeconds) || toleranceSeconds < 0) {
      throw new WebhookVerificationError("toleranceSeconds must be a whole number of seconds, 0 or more.");
    }
    if (typeof secret !== "string" || !secret.startsWith(WEBHOOK_SECRET_PREFIX)) throw new WebhookVerificationError("The webhook secret must start with whsec_.");
    const key = secretKey(secret);
    if (typeof rawBody !== "string" && !(rawBody instanceof Uint8Array)) {
      throw new WebhookVerificationError("Pass the raw request body as a string or Buffer, not parsed JSON.");
    }
    if (typeof headers !== "object" || headers === null) throw new WebhookVerificationError("The webhook-id, webhook-timestamp or webhook-signature header is missing.");

    const id = readHeader(headers, WEBHOOK_HEADERS.id);
    const timestamp = readHeader(headers, WEBHOOK_HEADERS.timestamp);
    const signatures = readHeader(headers, WEBHOOK_HEADERS.signature);
    if (!id || !timestamp || !signatures) throw new WebhookVerificationError("The webhook-id, webhook-timestamp or webhook-signature header is missing.");
    if (!TIMESTAMP_PATTERN.test(timestamp)) throw new WebhookVerificationError("webhook-timestamp must be a unix time in seconds.");

    const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
    /** Compared as standard base64 text, as Standard Webhooks does; Node's base64 decoder would also accept other spellings. */
    const expected = Buffer.from(createHmac("sha256", key).update(`${id}.${timestamp}.`).update(body).digest("base64"));
    const matches = signatures
      .split(" ")
      .filter((entry) => entry.startsWith(SIGNATURE_VERSION))
      .map((entry) => Buffer.from(entry.slice(SIGNATURE_VERSION.length)))
      .some((received) => received.length === expected.length && timingSafeEqual(expected, received));
    if (!matches) {
      throw new WebhookVerificationError("The webhook signature does not match. Check the webhook secret and pass the raw request body.");
    }

    const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
    if (ageSeconds > toleranceSeconds) {
      throw new WebhookVerificationError(`The webhook timestamp is more than ${toleranceSeconds} seconds from the current time.`);
    }

    let event: unknown;
    try {
      event = JSON.parse(new TextDecoder().decode(body));
    } catch {
      throw new WebhookVerificationError("The webhook body is not valid JSON.");
    }
    if (typeof event !== "object" || event === null || Array.isArray(event)) throw new WebhookVerificationError("The webhook body is not a JSON object.");
    return event as WebhookEvent;
  }
}
