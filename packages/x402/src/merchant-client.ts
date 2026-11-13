import { requestJson, secureUrl } from "./http.js";

/** Invoice fields the paywall reads (subset of `GET /api/v1/invoices/:id`). */
export interface Invoice {
  id: string;
  mode: string;
  status: string;
  amount: string;
  currency: string;
  metadata: Record<string, string>;
  settlement: { asset_id: string; symbol: string; blockchain: string; amount: string; amount_base: string };
  checkout_url: string;
  redeemed_at: string | null;
  expires_at: string;
}

export interface CreateInvoiceInput {
  amount: string;
  currency: string;
  description?: string;
  metadata?: Record<string, string>;
  expires_in?: number;
}

/** Subset of `POST /api/v1/invoices/:id/redeem`: the redemption and the payment that paid the invoice. */
export interface Redemption {
  id: string;
  redeemed_at: string;
  payment: {
    refund_address: string;
    confidential: boolean;
    destination_transactions: { hash: string }[];
  } | null;
}

export interface CreditCharge {
  id: string;
  balance: string;
}

export interface MerchantClientOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
}

/** Extra attempts per call. POSTs keep one Idempotency-Key across them, so Solverr replays the first result instead of repeating it. */
const RETRIES = 2;

/** Solverr merchant API calls made by the paywall. */
export class MerchantClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number | undefined;

  constructor(options: MerchantClientOptions) {
    this.baseUrl = secureUrl(options.baseUrl, "baseUrl").toString().replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs;
  }

  invoiceUrl(id: string, action?: "quote" | "deposit" | "status" | "redeem"): string {
    return `${this.baseUrl}/api/v1/invoices/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;
  }

  createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
    return requestJson({ method: "POST", url: `${this.baseUrl}/api/v1/invoices`, apiKey: this.apiKey, body: input, timeoutMs: this.timeoutMs, retries: RETRIES });
  }

  getInvoice(id: string): Promise<Invoice> {
    return requestJson({ method: "GET", url: this.invoiceUrl(id), apiKey: this.apiKey, timeoutMs: this.timeoutMs, retries: RETRIES });
  }

  /** Marks a paid invoice as used. Each call has its own Idempotency-Key, so its retries replay its own success,
      while a later call for the same invoice (another request reusing the payment) gets `already_redeemed`. */
  redeemInvoice(id: string): Promise<Redemption> {
    return requestJson({ method: "POST", url: this.invoiceUrl(id, "redeem"), apiKey: this.apiKey, body: {}, timeoutMs: this.timeoutMs, retries: RETRIES });
  }

  /** Deducts `amount` from a credit account once per call; Solverr refuses any `currency` other than USD. */
  chargeCredits(input: { token: string; amount: string; currency: string; description?: string }): Promise<CreditCharge> {
    return requestJson({ method: "POST", url: `${this.baseUrl}/api/v1/credits/charge`, apiKey: this.apiKey, body: input, timeoutMs: this.timeoutMs, retries: RETRIES });
  }

  /** Gives a credit charge back, at most once; used when the request it paid for failed. */
  refundCreditCharge(id: string): Promise<CreditCharge> {
    const url = `${this.baseUrl}/api/v1/credits/charges/${encodeURIComponent(id)}/refund`;
    return requestJson({ method: "POST", url, apiKey: this.apiKey, body: {}, timeoutMs: this.timeoutMs, retries: RETRIES });
  }
}
