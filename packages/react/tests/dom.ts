import { act } from "@testing-library/react";
import { vi } from "vitest";

export const APP_ORIGIN = "https://pay.example.com";

/** jsdom has no `matchMedia`, no real `scrollTo` and no `showModal`; reduced motion makes the overlay open and close without animations. */
export function stubBrowser(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: query.includes("prefers-reduced-motion: reduce"), media: query }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
}

export function checkoutFrame(): HTMLIFrameElement | null {
  return document.querySelector<HTMLIFrameElement>("iframe.solverr-frame");
}

export function overlayElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".solverr-overlay");
}

export function frameWindow(): Window {
  const frame = checkoutFrame()?.contentWindow;
  if (!frame) throw new Error("The checkout frame has no window.");
  return frame;
}

/** Posts a message on this window as if it came from `source` on `origin`. */
export function postMessage(data: unknown, origin: string, source: Window | null): void {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
  });
}

export function paidMessage(id = "inv_1") {
  return {
    source: "solverr",
    type: "paid",
    invoice: { id, object: "invoice", mode: "live", status: "paid", amount: "10.00", currency: "USD", order_id: null, receipt_url: null },
  };
}

export const CLOSE_MESSAGE = { source: "solverr", type: "close" };
