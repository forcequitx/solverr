import { type HttpClient, pathSegment } from "../http.js";
import type { CreditCharge, CreditChargeParams, CreditTopup, CreditTopupParams, RequestOptions } from "../types.js";

export class Credits {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Creates a credit account and token, or with `credit_account_id` reuses that account, plus the invoice that funds it; the balance is added once the invoice is paid. */
  topup(params: CreditTopupParams, options: RequestOptions = {}): Promise<CreditTopup> {
    return this.#http.request({ method: "POST", path: "/api/v1/credits/topup", body: params, idempotencyKey: options.idempotencyKey });
  }

  /** Deducts an amount from the credit account that owns `token` and returns the charge with the remaining balance. */
  charge(params: CreditChargeParams, options: RequestOptions = {}): Promise<CreditCharge> {
    return this.#http.request({ method: "POST", path: "/api/v1/credits/charge", body: params, idempotencyKey: options.idempotencyKey });
  }

  /** Gives a charge back to its credit account, once; for a request the charge paid for that then failed. */
  async refundCharge(id: string, options: RequestOptions = {}): Promise<CreditCharge> {
    return this.#http.request({ method: "POST", path: `/api/v1/credits/charges/${pathSegment(id)}/refund`, body: {}, idempotencyKey: options.idempotencyKey });
  }
}
