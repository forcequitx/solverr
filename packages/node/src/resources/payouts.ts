import { type HttpClient, pathSegment } from "../http.js";
import type { List, ListParams, Payout, PayoutBatch, PayoutBatchCreateParams, PayoutCreateParams, RequestOptions } from "../types.js";

export class Payouts {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Creates a payout, which the business completes by signing at `sign_url`. */
  create(params: PayoutCreateParams, options: RequestOptions = {}): Promise<Payout> {
    return this.#http.request({ method: "POST", path: "/api/v1/payouts", body: params, idempotencyKey: options.idempotencyKey });
  }

  /** Creates 1 to 200 payouts that share one `batch_id`; every row is checked before any payout is created. */
  createBatch(params: PayoutBatchCreateParams, options: RequestOptions = {}): Promise<PayoutBatch> {
    return this.#http.request({ method: "POST", path: "/api/v1/payouts/batch", body: params, idempotencyKey: options.idempotencyKey });
  }

  async retrieve(id: string): Promise<Payout> {
    return this.#http.request({ method: "GET", path: `/api/v1/payouts/${pathSegment(id)}` });
  }

  list(params: ListParams = {}): Promise<List<Payout>> {
    return this.#http.request({ method: "GET", path: "/api/v1/payouts", query: { ...params } });
  }

  /** Cancels a payout that was not sent. Fails with 409 once it was sent. */
  async cancel(id: string, options: RequestOptions = {}): Promise<Payout> {
    return this.#http.request({ method: "POST", path: `/api/v1/payouts/${pathSegment(id)}/cancel`, body: {}, idempotencyKey: options.idempotencyKey });
  }
}
