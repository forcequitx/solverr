import { type HttpClient, pathSegment } from "../http.js";
import type { List, ListParams, RequestOptions, Subscription, SubscriptionCreateParams } from "../types.js";

export class Subscriptions {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Creates a subscription that issues an invoice to the customer every interval. */
  create(params: SubscriptionCreateParams, options: RequestOptions = {}): Promise<Subscription> {
    return this.#http.request({ method: "POST", path: "/api/v1/subscriptions", body: params, idempotencyKey: options.idempotencyKey });
  }

  list(params: ListParams = {}): Promise<List<Subscription>> {
    return this.#http.request({ method: "GET", path: "/api/v1/subscriptions", query: { ...params } });
  }

  /** Cancels a subscription and returns it with status `canceled`; invoices already sent stay payable. */
  async cancel(id: string): Promise<Subscription> {
    return this.#http.request({ method: "DELETE", path: `/api/v1/subscriptions/${pathSegment(id)}` });
  }
}
