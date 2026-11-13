import { checkoutUrl } from "./checkout-url.js";
import { readCheckoutMessage } from "./messages.js";
import { lockPage } from "./page-lock.js";
import { PAID_EVENT, type PaidEventDetail } from "./paid-event.js";
import { injectStyles } from "./styles.js";
import type { CheckoutInvoice, CheckoutTarget } from "./types.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Whether the script's overlay is open; only one checkout is open at a time. */
let overlayOpen = false;

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function createElement<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  return element;
}

/** The close button's X icon, built without HTML parsing so pages that enforce Trusted Types accept it. */
function createCloseIcon(): SVGSVGElement {
  const icon = document.createElementNS(SVG_NS, "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M6 6l12 12M18 6L6 18");
  icon.append(path);
  return icon;
}

export interface OverlayOptions {
  /** Checkout page URL in overlay mode, from `checkoutUrl(origin, target, "overlay")`. */
  src: string;
  /** Origin of the Solverr app; only messages from the checkout frame on this origin are read. */
  origin: string;
  /** Called once for each paid invoice the checkout reports. */
  onPaid?: (invoice: CheckoutInvoice) => void;
  /** Called after the customer or the checkout closed the overlay and it is gone. */
  onClose?: () => void;
}

/** Shows the checkout in a full-screen overlay (`OVERLAY_CSS` must be on the page); returns a remover that skips `onClose`. */
export function showOverlay({ src, origin, onPaid, onClose }: OverlayOptions): () => void {
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const overlay = createElement("dialog", "solverr-overlay");
  overlay.setAttribute("aria-label", "Checkout");
  const panel = createElement("div", "solverr-panel");
  const bar = createElement("div", "solverr-bar");
  const closeButton = createElement("button", "solverr-close");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close checkout");
  closeButton.append(createCloseIcon());
  const frame = createElement("iframe", "solverr-frame");
  frame.title = "Checkout";
  frame.allow = "clipboard-write";
  frame.src = src;

  bar.append(closeButton);
  panel.append(bar, frame);
  overlay.append(panel);
  document.body.append(overlay);
  /** A modal dialog sits in the browser's top layer, above every z-index and above any modal dialog or popover the page already shows. */
  overlay.showModal();
  const unlockPage = lockPage(overlay);

  const animate = !prefersReducedMotion();
  if (animate) {
    overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
    panel.animate([{ opacity: 0, transform: "translateY(12px) scale(0.98)" }, { opacity: 1, transform: "none" }], {
      duration: 220,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    });
  }
  closeButton.focus();

  let closed = false;
  let paidInvoiceId: string | undefined;
  const onMessage = (event: MessageEvent) => {
    const message = readCheckoutMessage(event, origin, frame.contentWindow);
    if (!message) return;
    if (message.type === "close") return close();
    if (message.invoice.id === paidInvoiceId) return;
    paidInvoiceId = message.invoice.id;
    onPaid?.(message.invoice);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  };
  /** The browser's own close request, such as the Android back gesture, closes the overlay like its close button. */
  const onCancel = (event: Event) => {
    event.preventDefault();
    close();
  };

  /** Stops listening and restores the page; reports whether the overlay was still open. */
  function release(): boolean {
    if (closed) return false;
    closed = true;
    window.removeEventListener("message", onMessage);
    document.removeEventListener("keydown", onKeyDown, true);
    overlay.removeEventListener("cancel", onCancel);
    closeButton.removeEventListener("click", close);
    unlockPage();
    return true;
  }

  /** Removes the overlay, then returns focus: the page behind an open modal dialog is inert and cannot take focus until it is gone. */
  function remove() {
    overlay.remove();
    returnFocus?.focus();
  }

  function close() {
    if (!release()) return;
    overlay.dataset.state = "closing";
    const finish = () => {
      remove();
      onClose?.();
    };
    if (!animate) return finish();
    const fadeOut = overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: "ease-in", fill: "forwards" });
    fadeOut.onfinish = finish;
  }

  window.addEventListener("message", onMessage);
  document.addEventListener("keydown", onKeyDown, true);
  overlay.addEventListener("cancel", onCancel);
  closeButton.addEventListener("click", close);
  return () => {
    if (release()) remove();
  };
}

/** Opens the checkout for `target` in a full-screen overlay; only one checkout is open at a time.
    `solverr:paid` is dispatched on `trigger` (bubbling to window), or on window when there is no trigger. */
export function openCheckout(origin: string, target: CheckoutTarget, trigger?: Element): void {
  if (overlayOpen) return;
  const url = checkoutUrl(origin, target, "overlay");
  injectStyles();
  showOverlay({
    src: url.href,
    origin,
    onPaid: (invoice) => {
      const detail: PaidEventDetail = { invoice };
      const eventTarget = trigger?.isConnected ? trigger : window;
      eventTarget.dispatchEvent(new CustomEvent(PAID_EVENT, { bubbles: true, detail }));
    },
    onClose: () => {
      overlayOpen = false;
    },
  });
  overlayOpen = true;
}
