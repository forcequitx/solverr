import { type HttpClient, pathSegment } from "../http.js";
import type { Invoice, InvoiceCreateParams, InvoiceListParams, InvoiceRedemption, List, RequestOptions } from "../types.js";

const invoicePath = (id: string) => `/api/v1/invoices/${pathSegment(id)}`;

export class Invoices {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Creates an invoice; send the customer to `checkout_url`. */
  create(params: InvoiceCreateParams, options: RequestOptions = {}): Promise<Invoice> {
    return this.#http.request({ method: "POST", path: "/api/v1/invoices", body: params, idempotencyKey: options.idempotencyKey });
  }

  async retrieve(id: string): Promise<Invoice> {
    return this.#http.request({ method: "GET", path: invoicePath(id) });
  }

  /** One page of invoices, newest first. */
  list(params: InvoiceListParams = {}): Promise<List<Invoice>> {
    return this.#http.request({ method: "GET", path: "/api/v1/invoices", query: { ...params } });
  }

  /** Every matching invoice, newest first, fetching pages as the loop advances. */
  async *listAll(params: InvoiceListParams = {}): AsyncGenerator<Invoice, void, undefined> {
    let startingAfter = params.starting_after;
    while (true) {
      const page = await this.list({ ...params, starting_after: startingAfter });
      yield* page.data;
      const last = page.data.at(-1);
      if (!page.has_more || !last) return;
      startingAfter = last.id;
    }
  }

  /** Marks a paid invoice as used, so it grants access only once; 409 `invalid_state` when unpaid, `already_redeemed` when used before. */
  async redeem(id: string, options: RequestOptions = {}): Promise<InvoiceRedemption> {
    return this.#http.request({ method: "POST", path: `${invoicePath(id)}/redeem`, idempotencyKey: options.idempotencyKey });
  }
}
