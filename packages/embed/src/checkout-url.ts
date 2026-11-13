import type { CheckoutMode, CheckoutTarget } from "./types.js";

const LINK_ID = /^lnk_[A-Za-z0-9]{1,64}$/;
const INVOICE_ID = /^inv_[A-Za-z0-9]{1,64}$/;
/** Hosts that may serve the app over plain http, for local development. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Origin of the Solverr app from a base URL such as "https://pay.example.com"; http is accepted only for localhost. */
export function appOrigin(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    throw new TypeError("The Solverr base URL must be an https URL (http only for localhost).");
  }
  return url.origin;
}

/** Checkout page URL; ids are validated so they cannot change the path. Overlay mode adds this page's origin,
    the only page the checkout sends its messages to, so an overlay URL is built in the browser only. */
export function checkoutUrl(origin: string, target: CheckoutTarget, mode: CheckoutMode): URL {
  let path: string;
  if (target.link !== undefined) {
    if (!LINK_ID.test(target.link)) throw new TypeError(`"${target.link}" is not a payment link id (lnk_…).`);
    path = `/l/${target.link}`;
  } else {
    if (!INVOICE_ID.test(target.invoice)) throw new TypeError(`"${target.invoice}" is not an invoice id (inv_…).`);
    path = `/pay/${target.invoice}`;
  }
  const url = new URL(path, origin);
  if (mode === "overlay") {
    url.searchParams.set("embed", "1");
    url.searchParams.set("origin", window.location.origin);
  }
  return url;
}
