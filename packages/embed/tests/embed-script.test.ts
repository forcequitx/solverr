import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PAID_EVENT } from "../src/index.js";
import { APP_ORIGIN, checkoutFrame, overlayElement, paidMessage, postMessage, pressKey, stubBrowser } from "./dom.js";

const PAGE = `
  <a id="link" href="/fallback" data-solverr-link="lnk_abc"><span id="label">Pay</span></a>
  <button id="invoice" data-solverr-invoice="inv_xyz">Pay invoice</button>
  <button id="popup" data-solverr-invoice="inv_pop" data-solverr-mode="overlay">Pay in a popup</button>
  <button id="other">Other</button>`;

let browser: ReturnType<typeof stubBrowser>;

/** The script runs once per file, as on a real page; it reads its origin from the tag that loaded it. */
beforeAll(async () => {
  stubBrowser();
  const script = document.createElement("script");
  script.src = `${APP_ORIGIN}/embed.js`;
  document.head.append(script);
  await import("../src/embed.js");
});

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  browser = stubBrowser();
  document.body.innerHTML = PAGE;
});

afterEach(() => {
  pressKey("Escape");
});

function click(id: string, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
  document.getElementById(id)?.dispatchEvent(event);
  return event;
}

describe("script button", () => {
  it("opens the payment link page from a click inside the button", () => {
    const event = click("label");
    expect(event.defaultPrevented).toBe(true);
    expect(browser.assign).toHaveBeenCalledExactlyOnceWith(`${APP_ORIGIN}/l/lnk_abc`);
  });

  it("opens the invoice page", () => {
    click("invoice");
    expect(browser.assign).toHaveBeenCalledExactlyOnceWith(`${APP_ORIGIN}/pay/inv_xyz`);
  });

  it.each([["Ctrl", { ctrlKey: true }], ["Cmd", { metaKey: true }]])("opens a new tab on a %s click", (_label, init) => {
    click("link", init);
    expect(browser.open).toHaveBeenCalledExactlyOnceWith(`${APP_ORIGIN}/l/lnk_abc`, "_blank", "noopener");
    expect(browser.assign).not.toHaveBeenCalled();
  });

  it("leaves clicks on other elements alone", () => {
    const event = click("other");
    expect(event.defaultPrevented).toBe(false);
    expect(browser.assign).not.toHaveBeenCalled();
  });

  it("opens the overlay with data-solverr-mode=overlay and dispatches solverr:paid from the button", () => {
    const onButton = vi.fn();
    const onWindow = vi.fn();
    const button = document.getElementById("popup") as HTMLElement;
    button.addEventListener(PAID_EVENT, onButton);
    window.addEventListener(PAID_EVENT, onWindow);
    try {
      click("popup");
      expect(browser.assign).not.toHaveBeenCalled();
      const src = new URL(checkoutFrame()?.src ?? "");
      expect(src.origin).toBe(APP_ORIGIN);
      expect(src.pathname).toBe("/pay/inv_pop");
      expect(src.searchParams.get("embed")).toBe("1");
      postMessage(paidMessage("inv_pop"), APP_ORIGIN, checkoutFrame()?.contentWindow);
      expect(onButton).toHaveBeenCalledOnce();
      expect(onWindow).toHaveBeenCalledOnce();
      expect((onWindow.mock.calls[0]?.[0] as Event).target).toBe(button);
    } finally {
      window.removeEventListener(PAID_EVENT, onWindow);
    }
  });

  it("uses the page mode for an unknown data-solverr-mode", () => {
    document.getElementById("invoice")?.setAttribute("data-solverr-mode", "popup");
    click("invoice");
    expect(overlayElement()).toBeNull();
    expect(browser.assign).toHaveBeenCalledOnce();
  });

  it("does not open the overlay twice on a double click", () => {
    click("popup");
    click("popup");
    expect(document.querySelectorAll(".solverr-overlay")).toHaveLength(1);
  });
});

describe("window.Solverr", () => {
  it("opens the checkout page from code", () => {
    window.Solverr?.open({ invoice: "inv_code" });
    expect(browser.assign).toHaveBeenCalledExactlyOnceWith(`${APP_ORIGIN}/pay/inv_code`);
  });

  it("opens the overlay from code", () => {
    window.Solverr?.open({ link: "lnk_code" }, "overlay");
    expect(new URL(checkoutFrame()?.src ?? "").pathname).toBe("/l/lnk_code");
  });

  it("refuses an id that would change the path", () => {
    expect(() => window.Solverr?.open({ link: "lnk_../x" })).toThrow(/not a payment link id/);
    expect(browser.assign).not.toHaveBeenCalled();
  });

  it("is kept by a second copy of the script, which adds no second click handler", async () => {
    const first = window.Solverr;
    vi.resetModules();
    await import("../src/embed.js");
    expect(window.Solverr).toBe(first);
    click("invoice");
    expect(browser.assign).toHaveBeenCalledOnce();
  });
});
