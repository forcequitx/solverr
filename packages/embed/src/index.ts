import { goToCheckout } from "./checkout-page.js";
import { appOrigin } from "./checkout-url.js";
import { openCheckout } from "./overlay.js";
import type { CheckoutMode, CheckoutTarget } from "./types.js";

export { PAID_EVENT, type PaidEventDetail } from "./paid-event.js";
export type { CheckoutInvoice, CheckoutMode, CheckoutTarget, InvoiceStatus } from "./types.js";

export type OpenOptions = CheckoutTarget & {
  /** Origin of the Solverr app, such as "https://pay.example.com". */
  baseUrl: string;
  /** "page" (default) goes to the full checkout page; "overlay" opens it over this page and dispatches `solverr:paid` on window. */
  mode?: CheckoutMode;
};

/** Opens the checkout for a payment link or an invoice: the full checkout page by default, or an overlay. */
export function open({ baseUrl, mode = "page", ...target }: OpenOptions): void {
  const origin = appOrigin(baseUrl);
  if (mode === "overlay") openCheckout(origin, target as CheckoutTarget);
  else goToCheckout(origin, target as CheckoutTarget);
}
