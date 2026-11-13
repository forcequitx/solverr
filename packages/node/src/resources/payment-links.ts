import { type HttpClient, pathSegment } from "../http.js";
import type { List, ListParams, PaymentLink, PaymentLinkCreateParams, RequestOptions } from "../types.js";

export class PaymentLinks {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  create(params: PaymentLinkCreateParams, options: RequestOptions = {}): Promise<PaymentLink> {
    return this.#http.request({ method: "POST", path: "/api/v1/payment-links", body: params, idempotencyKey: options.idempotencyKey });
  }

  list(params: ListParams = {}): Promise<List<PaymentLink>> {
    return this.#http.request({ method: "GET", path: "/api/v1/payment-links", query: { ...params } });
  }

  /** Turns a link off and returns it with `active` false; invoices already created from it stay payable. */
  async deactivate(id: string): Promise<PaymentLink> {
    return this.#http.request({ method: "DELETE", path: `/api/v1/payment-links/${pathSegment(id)}` });
  }
}
