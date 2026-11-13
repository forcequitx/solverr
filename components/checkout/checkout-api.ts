import type { CheckoutState } from "@/lib/payments/checkout-state";
import type { Estimate } from "@/lib/payments/estimate";

export type Payment = NonNullable<CheckoutState["payment"]>;
/** A payment found by transaction hash alone: only its status, because a hash is public on chain. */
export type PaymentLookup = { object: "payment_lookup"; status: CheckoutState["status"] };
/** An open support case with the report to send to NEAR Intents support. */
export type SupportCase = { id: string; kind: string; report_text: string; support_url: string };

/** An API error with the server's HTTP status, error type and field, so the page can show its own text for it. */
export class CheckoutApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly type?: string,
    readonly param?: string,
    /** Seconds until a rate-limited request may be retried, from `Retry-After`. */
    readonly retryAfter?: number,
    /** Finer reason inside the type, such as `invoice_paid`. */
    readonly code?: string,
  ) {
    super(message);
    this.name = "CheckoutApiError";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after")) || undefined;
    throw new CheckoutApiError(body?.error?.message ?? "", response.status, body?.error?.type, body?.error?.param, retryAfter, body?.error?.code);
  }
  return body as T;
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const checkoutApi = {
  state: (invoiceId: string) => call<CheckoutState>(`/api/v1/invoices/${invoiceId}/status`, { cache: "no-store" }),
  quote: (invoiceId: string, originAsset: string, refundAddress: string) =>
    call<Payment>(`/api/v1/invoices/${invoiceId}/quote`, post({ origin_asset: originAsset, refund_address: refundAddress })),
  /** Without `refundAddress`, each coin is only checked for whether it can pay and what it costs. */
  estimate: (invoiceId: string, originAssets: string[], refundAddress?: string) =>
    call<{ data: Estimate[] }>(`/api/v1/invoices/${invoiceId}/estimate`, post({ origin_assets: originAssets, ...(refundAddress ? { refund_address: refundAddress } : {}) })),
  deposit: (invoiceId: string, txHash: string, paymentId: string) =>
    call<CheckoutState>(`/api/v1/invoices/${invoiceId}/deposit`, post({ tx_hash: txHash, payment_id: paymentId })),
  /** For a wallet that sends without returning a hash (TON), so the server remembers the payment is on its way. */
  walletSent: (invoiceId: string, paymentId: string) =>
    call<CheckoutState>(`/api/v1/invoices/${invoiceId}/deposit`, post({ wallet_sent: true, payment_id: paymentId })),
  simulate: (invoiceId: string, outcome: "paid" | "underpaid" | "refunded" | "failed") => call<void>(`/api/v1/invoices/${invoiceId}/simulate`, post({ outcome })),
  saveReceiptEmail: (invoiceId: string, email: string) => call<void>(`/api/v1/invoices/${invoiceId}/email`, post({ email })),
  /** Creates the invoice for a payment link; `amount` is the customer's amount on links without a fixed one. */
  startPaymentLink: (linkId: string, amount: string | null) =>
    call<{ id: string }>(`/api/v1/payment-links/${linkId}/invoices`, post(amount === null ? {} : { amount })),
  /** Finds a payment for the help page by its payment ID or by a transaction hash sent to it. */
  lookupPayment: (query: { invoice_id: string } | { tx_hash: string }) => call<CheckoutState | PaymentLookup>(`/api/v1/support-cases/lookup?${new URLSearchParams(query)}`),
  openSupportCase: (input: { invoice_id?: string; tx_hash: string; chain: string; kind: string; details?: string }) => call<SupportCase>("/api/v1/support-cases", post(input)),
};
