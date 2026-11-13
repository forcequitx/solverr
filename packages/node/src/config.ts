export const SDK_VERSION = "0.1.0";

export const BASE_URL_ENV = "SOLVERR_URL";

/** Hosts that may serve the API over plain http, for local development; every other host needs https. */
export const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const REQUEST_TIMEOUT_MS = 15_000;

/** Extra attempts after a network error or a 5xx response. */
export const MAX_RETRIES = 2;

/** Delay before the first retry; each later retry doubles it. */
export const RETRY_BASE_DELAY_MS = 500;

/** Extra attempts after a 429, or a 409 for a key that is still being processed, each after its `Retry-After` wait. */
export const MAX_RETRY_AFTER_RETRIES = 3;

/** Longest `Retry-After` the client waits for; a longer one is returned as an error. */
export const MAX_RETRY_AFTER_SECONDS = 10;

export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** Standard Webhooks headers (standardwebhooks.com), lowercase for lookups. */
export const WEBHOOK_HEADERS = {
  id: "webhook-id",
  timestamp: "webhook-timestamp",
  signature: "webhook-signature",
} as const;

export const WEBHOOK_SECRET_PREFIX = "whsec_";

/** Shortest signing key accepted after decoding; Standard Webhooks secrets are 24 to 64 bytes. */
export const WEBHOOK_SECRET_MIN_BYTES = 24;
