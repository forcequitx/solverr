import { vi } from "vitest";

export const APP_ORIGIN = "https://pay.example.com";

/** jsdom has no `matchMedia`, no navigation and no `showModal`, so they are stubbed; `reducedMotion` skips the overlay animations. */
export function stubBrowser({ reducedMotion = true } = {}) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: reducedMotion && query.includes("prefers-reduced-motion: reduce"), media: query }),
  });
  const showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: showModal });
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const assign = vi.fn<(url: string) => void>();
  vi.stubGlobal("location", { origin: window.location.origin, href: window.location.href, assign });
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  return { assign, open, scrollTo, showModal };
}

export function checkoutFrame(): HTMLIFrameElement | null {
  return document.querySelector<HTMLIFrameElement>("iframe.solverr-frame");
}

export function overlayElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".solverr-overlay");
}

/** Posts a message on this window as if it came from `source` on `origin`. */
export function postMessage(data: unknown, origin: string, source: Window | null | undefined): void {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source: source ?? null }));
}

export function paidMessage(id = "inv_1") {
  return {
    source: "solverr",
    type: "paid",
    invoice: { id, object: "invoice", mode: "live", status: "paid", amount: "10.00", currency: "USD", order_id: null, receipt_url: null },
  };
}

export const CLOSE_MESSAGE = { source: "solverr", type: "close" };

export function pressKey(key: string, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}
