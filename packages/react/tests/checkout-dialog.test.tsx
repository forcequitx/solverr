import type { CheckoutTarget } from "solverr-embed/core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutDialog } from "../src/checkout-dialog.js";
import { APP_ORIGIN, checkoutFrame, CLOSE_MESSAGE, frameWindow, overlayElement, paidMessage, postMessage, stubBrowser } from "./dom.js";

const TARGET: CheckoutTarget = { invoice: "inv_1" };

beforeEach(() => {
  stubBrowser();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CheckoutDialog", () => {
  it("shows the overlay while mounted and renders nothing itself", () => {
    const { container, unmount } = render(<CheckoutDialog origin={APP_ORIGIN} target={TARGET} onClose={() => {}} />);
    expect(container.innerHTML).toBe("");
    expect(new URL(checkoutFrame()?.src ?? "").pathname).toBe("/pay/inv_1");
    unmount();
    expect(overlayElement()).toBeNull();
  });

  it("calls onPaid for a paid message from the checkout frame on the app origin", () => {
    const onPaid = vi.fn();
    render(<CheckoutDialog origin={APP_ORIGIN} target={TARGET} onPaid={onPaid} onClose={() => {}} />);
    const message = paidMessage("inv_1");
    postMessage(message, APP_ORIGIN, frameWindow());
    expect(onPaid).toHaveBeenCalledExactlyOnceWith(message.invoice);
  });

  it("calls onClose for a close message from the checkout frame", () => {
    const onClose = vi.fn();
    render(<CheckoutDialog origin={APP_ORIGIN} target={TARGET} onClose={onClose} />);
    postMessage(CLOSE_MESSAGE, APP_ORIGIN, frameWindow());
    expect(onClose).toHaveBeenCalledOnce();
    expect(overlayElement()).toBeNull();
  });

  it.each([
    ["another origin with the frame as source", "https://evil.example", true],
    ["the app origin with this page as source", APP_ORIGIN, false],
  ])("ignores messages from %s", (_label, origin, fromFrame) => {
    const onPaid = vi.fn();
    const onClose = vi.fn();
    render(<CheckoutDialog origin={APP_ORIGIN} target={TARGET} onPaid={onPaid} onClose={onClose} />);
    const source = fromFrame ? frameWindow() : window;
    postMessage(paidMessage(), origin, source);
    postMessage(CLOSE_MESSAGE, origin, source);
    expect(onPaid).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(overlayElement()).not.toBeNull();
  });

  it("calls the latest handlers after a re-render without reopening the overlay", () => {
    const firstPaid = vi.fn();
    const latestPaid = vi.fn();
    const { rerender } = render(<CheckoutDialog origin={APP_ORIGIN} target={TARGET} onPaid={firstPaid} onClose={() => {}} />);
    const frame = checkoutFrame();
    rerender(<CheckoutDialog origin={APP_ORIGIN} target={TARGET} onPaid={latestPaid} onClose={() => {}} />);
    expect(checkoutFrame()).toBe(frame);
    postMessage(paidMessage(), APP_ORIGIN, frameWindow());
    expect(firstPaid).not.toHaveBeenCalled();
    expect(latestPaid).toHaveBeenCalledOnce();
  });

  it("does not call onClose when unmounted by its parent", () => {
    const onClose = vi.fn();
    const { unmount } = render(<CheckoutDialog origin={APP_ORIGIN} target={TARGET} onClose={onClose} />);
    unmount();
    expect(onClose).not.toHaveBeenCalled();
  });
});
