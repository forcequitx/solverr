import type { CheckoutInvoice } from "./types.js";

export const PAID_EVENT = "solverr:paid";

/** `detail` of the `solverr:paid` event. */
export interface PaidEventDetail {
  invoice: CheckoutInvoice;
}

/** Types `event.detail` in `addEventListener("solverr:paid", …)` on window and on the button that opened the overlay. */
declare global {
  interface WindowEventMap {
    "solverr:paid": CustomEvent<PaidEventDetail>;
  }
  interface HTMLElementEventMap {
    "solverr:paid": CustomEvent<PaidEventDetail>;
  }
}
