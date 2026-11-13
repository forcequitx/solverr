/** Extra details of a `SolverrError`: the underlying `cause`, and the `Retry-After` wait the API sent. */
export interface SolverrErrorOptions extends ErrorOptions {
  retryAfter?: number;
}

/** An error returned by the Solverr API, or a request that never got a response (`status` 0). */
export class SolverrError extends Error {
  readonly status: number;
  readonly type: string;
  readonly param: string | undefined;
  /** Finer reason inside `type`, such as `invoice_paid`, when the API sends one. */
  readonly code: string | undefined;
  /** Seconds the API asked to wait before trying again (its `Retry-After` header), such as on a 429. */
  readonly retryAfter: number | undefined;

  constructor(status: number, type: string, message: string, param?: string, code?: string, options?: SolverrErrorOptions) {
    super(message, options);
    this.name = "SolverrError";
    this.status = status;
    this.type = type;
    this.param = param;
    this.code = code;
    this.retryAfter = options?.retryAfter;
  }
}

/** A webhook whose signature, timestamp or body could not be verified. */
export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}
