/** What to open: a payment link, or an invoice created by the merchant's server. */
export type CheckoutTarget = { link: string; invoice?: never } | { invoice: string; link?: never };

/** How the checkout opens: the full checkout page (default), or a popup over the current page. */
export type CheckoutMode = "page" | "overlay";

export type InvoiceStatus =
  | "created"
  | "awaiting_payment"
  | "detected"
  | "processing"
  | "paid"
  | "underpaid"
  | "refunded"
  | "failed"
  | "expired";

/** Invoice fields the checkout page shares with the embedding page when payment completes. */
export interface CheckoutInvoice {
  id: string;
  object: "invoice";
  mode: "live" | "test";
  status: InvoiceStatus;
  amount: string;
  currency: "USD" | "EUR" | "INR";
  order_id: string | null;
  receipt_url: string | null;
}
