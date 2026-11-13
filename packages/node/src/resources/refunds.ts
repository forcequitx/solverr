import { type HttpClient, pathSegment } from "../http.js";
import type { List, ListParams, Refund, RefundCreateParams, RequestOptions } from "../types.js";

export class Refunds {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Creates a refund, which the business completes by signing at `sign_url`. */
  create(params: RefundCreateParams, options: RequestOptions = {}): Promise<Refund> {
    return this.#http.request({ method: "POST", path: "/api/v1/refunds", body: params, idempotencyKey: options.idempotencyKey });
  }

  async retrieve(id: string): Promise<Refund> {
    return this.#http.request({ method: "GET", path: `/api/v1/refunds/${pathSegment(id)}` });
  }

  list(params: ListParams = {}): Promise<List<Refund>> {
    return this.#http.request({ method: "GET", path: "/api/v1/refunds", query: { ...params } });
  }

  /** Cancels a refund that was not sent; its amount can then be refunded again. Fails with 409 once it was sent. */
  async cancel(id: string, options: RequestOptions = {}): Promise<Refund> {
    return this.#http.request({ method: "POST", path: `/api/v1/refunds/${pathSegment(id)}/cancel`, body: {}, idempotencyKey: options.idempotencyKey });
  }
}
