/** x402 protocol version implemented by this package. */
export const X402_VERSION = 2;

/** Scheme name for payments settled through a Solverr invoice. */
export const SOLVERR_SCHEME = "solverr";

/** Standard x402 scheme for a signed transfer of an exact token amount, settled by a facilitator. */
export const EXACT_SCHEME = "exact";

/** x402 v2 HTTP headers; each value is base64-encoded JSON. */
export const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
export const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";
export const PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE";

/** `extra` of a `solverr` payment requirement: where and how to pay the invoice. */
export interface SolverrRequirementExtra {
  invoice_id: string;
  /** Always `live` for merchant invoices; agents refuse any other value, since only demo store invoices are `test`. */
  mode: string;
  checkout_url: string;
  quote_url: string;
  deposit_url: string;
  status_url: string;
  /** Price as set by the merchant, in `currency`. */
  price: string;
  currency: string;
  settlement: { asset_id: string; symbol: string; blockchain: string; amount: string };
  expires_at: string;
  /** Whether the endpoint also accepts `Authorization: Bearer solverr_credit_…`. */
  credits: boolean;
}

/** `payload` of a `solverr` payment: the paid invoice to redeem. */
export interface SolverrPaymentPayload {
  invoice_id: string;
}

/** Reads an x402 header with an `@x402/core` decoder; URL-safe base64 is read as standard, a missing or malformed header gives `undefined`. */
export function readHeader<T>(value: string | null | undefined, decode: (header: string) => T): T | undefined {
  if (!value) return undefined;
  try {
    return decode(value.trim().replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return undefined;
  }
}
