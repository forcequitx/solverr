export type PaymentErrorCode =
  | "host_not_allowed"
  | "per_payment_limit"
  | "daily_limit"
  | "invalid_challenge"
  | "untrusted_gateway"
  | "test_invoice"
  | "invoice_expired"
  | "no_funds"
  | "quote_unavailable"
  | "quote_mismatch"
  | "transfer_failed"
  | "payment_failed"
  | "payment_timeout"
  | "payment_unconfirmed"
  | "paid_request_failed"
  | "body_not_replayable";

/** First line of an error message, bounded, for logs and tool output. */
export function errorSummary(error: unknown, maxLength = 300): string {
  return (error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, maxLength);
}

/** A payment the agent refused or could not complete; `fundsSent` is true once a transfer was broadcast, and `invoiceId` then names its invoice. */
export class PaymentError extends Error {
  constructor(
    readonly code: PaymentErrorCode,
    message: string,
    readonly fundsSent = false,
    readonly invoiceId?: string,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}
