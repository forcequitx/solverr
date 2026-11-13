import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { showOverlay } from "../src/core.js";
import { open, PAID_EVENT, type PaidEventDetail } from "../src/index.js";
import { openCheckout } from "../src/overlay.js";
import { APP_ORIGIN, checkoutFrame, CLOSE_MESSAGE, overlayElement, paidMessage, postMessage, pressKey, stubBrowser } from "./dom.js";

const SRC = `${APP_ORIGIN}/pay/inv_1?embed=1`;

let browser: ReturnType<typeof stubBrowser>;

beforeEach(() => {
  browser = stubBrowser();
  document.body.innerHTML = '<main id="page"><button id="buy">Buy</button></main>';
});

afterEach(() => {
  pressKey("Escape");
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  document.documentElement.removeAttribute("style");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function frameWindow(): Window {
  const frame = checkoutFrame()?.contentWindow;
  if (!frame) throw new Error("The checkout frame has no window.");
  return frame;
}

describe("showOverlay", () => {
  it("shows a modal dialog with the checkout frame and focuses the close button", () => {
    showOverlay({ src: SRC, origin: APP_ORIGIN });
    const overlay = overlayElement();
    expect(overlay?.tagName).toBe("DIALOG");
    expect(browser.showModal).toHaveBeenCalledOnce();
    expect(browser.showModal.mock.contexts[0]).toBe(overlay);
    expect(overlay?.hasAttribute("open")).toBe(true);
    expect(overlay?.getAttribute("aria-label")).toBe("Checkout");
    expect(checkoutFrame()?.src).toBe(SRC);
    expect(checkoutFrame()?.title).toBe("Checkout");
    expect(document.activeElement).toBe(document.querySelector(".solverr-close"));
    expect(document.querySelector(".solverr-close svg path")?.namespaceURI).toBe("http://www.w3.org/2000/svg");
  });

  it("locks the page: no scrolling and every other top-level element inert, even ones added later", async () => {
    showOverlay({ src: SRC, origin: APP_ORIGIN });
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.body.style.position).toBe("fixed");
    expect(document.getElementById("page")?.hasAttribute("inert")).toBe(true);
    expect(overlayElement()?.hasAttribute("inert")).toBe(false);
    const late = document.createElement("div");
    document.body.append(late);
    await Promise.resolve();
    expect(late.hasAttribute("inert")).toBe(true);
  });

  it("calls onPaid for a paid message from the checkout frame on the app origin", () => {
    const onPaid = vi.fn();
    showOverlay({ src: SRC, origin: APP_ORIGIN, onPaid });
    const message = paidMessage("inv_1");
    postMessage(message, APP_ORIGIN, frameWindow());
    expect(onPaid).toHaveBeenCalledExactlyOnceWith(message.invoice);
  });

  it("reports each paid invoice once", () => {
    const onPaid = vi.fn();
    showOverlay({ src: SRC, origin: APP_ORIGIN, onPaid });
    postMessage(paidMessage("inv_1"), APP_ORIGIN, frameWindow());
    postMessage(paidMessage("inv_1"), APP_ORIGIN, frameWindow());
    postMessage(paidMessage("inv_2"), APP_ORIGIN, frameWindow());
    expect(onPaid.mock.calls.map(([invoice]) => (invoice as { id: string }).id)).toEqual(["inv_1", "inv_2"]);
  });

  it.each([
    ["the right window on another origin", "https://evil.example", true],
    ["the right window over http", "http://pay.example.com", true],
    ["this page on the app origin", APP_ORIGIN, false],
  ])("ignores messages from %s", (_label, origin, fromFrame) => {
    const onPaid = vi.fn();
    const onClose = vi.fn();
    showOverlay({ src: SRC, origin: APP_ORIGIN, onPaid, onClose });
    const source = fromFrame ? frameWindow() : window;
    postMessage(paidMessage(), origin, source);
    postMessage(CLOSE_MESSAGE, origin, source);
    expect(onPaid).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(overlayElement()).not.toBeNull();
  });

  it("closes on a close message: removes the overlay, unlocks the page, returns focus and calls onClose", () => {
    const buy = document.getElementById("buy") as HTMLButtonElement;
    buy.focus();
    const onClose = vi.fn();
    showOverlay({ src: SRC, origin: APP_ORIGIN, onClose });
    postMessage(CLOSE_MESSAGE, APP_ORIGIN, frameWindow());
    expect(overlayElement()).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(buy);
    expect(document.getElementById("page")?.hasAttribute("inert")).toBe(false);
    expect(document.documentElement.style.overflow).toBe("");
    expect(document.body.style.position).toBe("");
    expect(browser.scrollTo).toHaveBeenCalled();
  });

  it("closes on Escape pressed anywhere and prevents the key's default action", () => {
    const onClose = vi.fn();
    showOverlay({ src: SRC, origin: APP_ORIGIN, onClose });
    const event = pressKey("Escape", document.getElementById("page") as HTMLElement);
    expect(event.defaultPrevented).toBe(true);
    expect(overlayElement()).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on the browser's close request, such as the Android back gesture, instead of letting the dialog close by itself", () => {
    const onClose = vi.fn();
    showOverlay({ src: SRC, origin: APP_ORIGIN, onClose });
    const cancel = new Event("cancel", { cancelable: true });
    overlayElement()?.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(overlayElement()).toBeNull();
    expect(document.getElementById("page")?.hasAttribute("inert")).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("stays open on other keys", () => {
    showOverlay({ src: SRC, origin: APP_ORIGIN });
    pressKey("Enter");
    pressKey("Tab");
    expect(overlayElement()).not.toBeNull();
  });

  it("closes from the close button", () => {
    const onClose = vi.fn();
    showOverlay({ src: SRC, origin: APP_ORIGIN, onClose });
    document.querySelector<HTMLButtonElement>(".solverr-close")?.click();
    expect(overlayElement()).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose only once and stops listening after closing", () => {
    const onClose = vi.fn();
    const onPaid = vi.fn();
    showOverlay({ src: SRC, origin: APP_ORIGIN, onClose, onPaid });
    const frame = frameWindow();
    postMessage(CLOSE_MESSAGE, APP_ORIGIN, frame);
    postMessage(CLOSE_MESSAGE, APP_ORIGIN, frame);
    postMessage(paidMessage(), APP_ORIGIN, frame);
    pressKey("Escape");
    expect(onClose).toHaveBeenCalledOnce();
    expect(onPaid).not.toHaveBeenCalled();
  });

  it("returns a remover that takes the overlay away without calling onClose", () => {
    const onClose = vi.fn();
    const remove = showOverlay({ src: SRC, origin: APP_ORIGIN, onClose });
    remove();
    expect(overlayElement()).toBeNull();
    expect(document.getElementById("page")?.hasAttribute("inert")).toBe(false);
    pressKey("Escape");
    remove();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("animates the close and calls onClose once the fade-out finishes", () => {
    vi.unstubAllGlobals();
    stubBrowser({ reducedMotion: false });
    const animations: Array<{ onfinish: (() => void) | null }> = [];
    const animate = vi.fn(() => {
      const animation = { onfinish: null };
      animations.push(animation);
      return animation as unknown as Animation;
    });
    Object.defineProperty(Element.prototype, "animate", { configurable: true, value: animate });
    try {
      const onClose = vi.fn();
      showOverlay({ src: SRC, origin: APP_ORIGIN, onClose });
      expect(animate).toHaveBeenCalledTimes(2);
      pressKey("Escape");
      expect(overlayElement()?.dataset.state).toBe("closing");
      expect(onClose).not.toHaveBeenCalled();
      animations.at(-1)?.onfinish?.();
      expect(overlayElement()).toBeNull();
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      Reflect.deleteProperty(Element.prototype, "animate");
    }
  });
});

describe("openCheckout", () => {
  it("opens one overlay at a time and adds the stylesheet once", () => {
    openCheckout(APP_ORIGIN, { invoice: "inv_1" });
    openCheckout(APP_ORIGIN, { invoice: "inv_2" });
    expect(document.querySelectorAll(".solverr-overlay")).toHaveLength(1);
    expect(document.querySelectorAll("#solverr-embed-styles")).toHaveLength(1);
    const src = new URL(checkoutFrame()?.src ?? "");
    expect(src.pathname).toBe("/pay/inv_1");
    expect(src.searchParams.get("origin")).toBe(window.location.origin);
  });

  it("opens again after the overlay closed", () => {
    openCheckout(APP_ORIGIN, { link: "lnk_1" });
    pressKey("Escape");
    openCheckout(APP_ORIGIN, { link: "lnk_2" });
    expect(new URL(checkoutFrame()?.src ?? "").pathname).toBe("/l/lnk_2");
  });

  it("dispatches solverr:paid on the trigger, bubbling to window", () => {
    const trigger = document.getElementById("buy") as HTMLButtonElement;
    const onTrigger = vi.fn();
    const onWindow = vi.fn();
    trigger.addEventListener(PAID_EVENT, onTrigger);
    window.addEventListener(PAID_EVENT, onWindow);
    try {
      openCheckout(APP_ORIGIN, { invoice: "inv_1" }, trigger);
      const message = paidMessage("inv_1");
      postMessage(message, APP_ORIGIN, frameWindow());
      expect(onTrigger).toHaveBeenCalledOnce();
      expect(onWindow).toHaveBeenCalledOnce();
      const event = onTrigger.mock.calls[0]?.[0] as CustomEvent<PaidEventDetail>;
      expect(event.target).toBe(trigger);
      expect(event.bubbles).toBe(true);
      expect(event.detail).toEqual({ invoice: message.invoice });
    } finally {
      window.removeEventListener(PAID_EVENT, onWindow);
    }
  });

  it("types the solverr:paid listener's event on window and on elements", () => {
    expectTypeOf<WindowEventMap[typeof PAID_EVENT]>().toEqualTypeOf<CustomEvent<PaidEventDetail>>();
    expectTypeOf<HTMLElementEventMap["solverr:paid"]>().toEqualTypeOf<CustomEvent<PaidEventDetail>>();
    const trigger = document.getElementById("buy") as HTMLButtonElement;
    const ids: string[] = [];
    const onWindow = (event: WindowEventMap["solverr:paid"]) => ids.push(`window:${event.detail.invoice.id}`);
    trigger.addEventListener("solverr:paid", (event) => ids.push(`button:${event.detail.invoice.id}`));
    window.addEventListener(PAID_EVENT, onWindow);
    try {
      openCheckout(APP_ORIGIN, { invoice: "inv_1" }, trigger);
      postMessage(paidMessage("inv_1"), APP_ORIGIN, frameWindow());
      expect(ids).toEqual(["button:inv_1", "window:inv_1"]);
    } finally {
      window.removeEventListener(PAID_EVENT, onWindow);
    }
  });

  it("dispatches solverr:paid on window when the trigger left the page", () => {
    const trigger = document.getElementById("buy") as HTMLButtonElement;
    const onTrigger = vi.fn();
    const onWindow = vi.fn();
    trigger.addEventListener(PAID_EVENT, onTrigger);
    window.addEventListener(PAID_EVENT, onWindow);
    try {
      openCheckout(APP_ORIGIN, { invoice: "inv_1" }, trigger);
      trigger.remove();
      postMessage(paidMessage(), APP_ORIGIN, frameWindow());
      expect(onTrigger).not.toHaveBeenCalled();
      expect(onWindow).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener(PAID_EVENT, onWindow);
    }
  });

  it("refuses an invalid id without opening anything", () => {
    expect(() => openCheckout(APP_ORIGIN, { invoice: "inv_../admin" })).toThrow(/not an invoice id/);
    expect(overlayElement()).toBeNull();
    openCheckout(APP_ORIGIN, { invoice: "inv_1" });
    expect(overlayElement()).not.toBeNull();
  });
});

describe("open", () => {
  it("goes to the full checkout page by default", () => {
    open({ baseUrl: "https://pay.example.com/anything", link: "lnk_1" });
    expect(browser.assign).toHaveBeenCalledExactlyOnceWith("https://pay.example.com/l/lnk_1");
    expect(overlayElement()).toBeNull();
  });

  it("opens the overlay in overlay mode and reports payment on window", () => {
    const onWindow = vi.fn();
    window.addEventListener(PAID_EVENT, onWindow);
    try {
      open({ baseUrl: APP_ORIGIN, invoice: "inv_1", mode: "overlay" });
      expect(browser.assign).not.toHaveBeenCalled();
      postMessage(paidMessage(), APP_ORIGIN, frameWindow());
      expect(onWindow).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener(PAID_EVENT, onWindow);
    }
  });

  it("refuses a base URL that is not https", () => {
    expect(() => open({ baseUrl: "http://pay.example.com", link: "lnk_1" })).toThrow(/https URL/);
    expect(browser.assign).not.toHaveBeenCalled();
  });
});
