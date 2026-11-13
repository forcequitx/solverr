export const DEFAULT_NEAR_RPC_URL = "https://free.rpc.fastnear.com";
export const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org";

/** Timeout for one RPC or Solverr API call. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
/** Default `resourceTimeoutMs`: the first resource request when the caller passes no `signal`, and every paid attempt, which ignores the
    caller's signal; each includes reading the body. */
export const DEFAULT_RESOURCE_TIMEOUT_MS = 30_000;
/** Total sends of the paid request, the first included (repeated after network errors, 429 or 5xx), and the delay step between them. */
export const PAID_REQUEST_ATTEMPTS = 3;
export const PAID_REQUEST_RETRY_MS = 1_000;
/** Longest wait between paid attempts, even when a 429 or 503 asks for more in `Retry-After`; a paywall's challenge limit counts per minute. */
export const PAID_REQUEST_MAX_WAIT_MS = 60_000;
/** How long to wait for an invoice to become paid after the transfer. */
export const DEFAULT_PAYMENT_TIMEOUT_MS = 180_000;
/** How long to wait for a transfer to be included on-chain before relying on the gateway to detect it. */
export const DEFAULT_TRANSFER_TIMEOUT_MS = 60_000;
export const STATUS_POLL_INTERVAL_MS = 3_000;

/** Different coins are tried in turn when a quote is refused, up to this many. */
export const MAX_QUOTE_ATTEMPTS = 3;
/** Headroom over the settlement value when estimating the amount a coin must cover (fees and slippage). */
export const ESTIMATE_BUFFER = 0.03;
/** A quote may cost at most this share more than the invoice's USD value (not the buffered estimate) before the payment is refused. */
export const MAX_QUOTE_OVER_ESTIMATE = 0.1;
/** A quote must stay valid at least this long after it is received. */
export const MIN_QUOTE_VALIDITY_MS = 60_000;

/** Entries older than this are dropped from the spend log. */
export const SPEND_LOG_RETENTION_MS = 30 * 24 * 60 * 60_000;
/** How often a busy spend log lock is retried, and how long to wait for it in total. */
export const SPEND_LOG_LOCK_RETRY_MS = 50;
export const SPEND_LOG_LOCK_TIMEOUT_MS = 10_000;
/** A lock file older than this was left by a process that stopped while holding it. */
export const SPEND_LOG_STALE_LOCK_MS = 30_000;
export const DAY_MS = 24 * 60 * 60_000;
