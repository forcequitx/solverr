import { checkoutUrl } from "./checkout-url.js";
import type { CheckoutTarget } from "./types.js";

/** Goes to the full checkout page for `target`: in this tab, or in a new tab (for Ctrl or Cmd clicks). */
export function goToCheckout(origin: string, target: CheckoutTarget, newTab = false): void {
  const url = checkoutUrl(origin, target, "page").href;
  if (newTab) window.open(url, "_blank", "noopener");
  else window.location.assign(url);
}
