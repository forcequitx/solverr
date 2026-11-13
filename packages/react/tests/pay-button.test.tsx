import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { PayButton, SolverrProvider } from "../src/index.js";
import { APP_ORIGIN, checkoutFrame, CLOSE_MESSAGE, frameWindow, overlayElement, paidMessage, postMessage, stubBrowser } from "./dom.js";

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  stubBrowser();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  document.head.innerHTML = "";
  vi.restoreAllMocks();
});

describe("page mode", () => {
  it("renders a link to the payment link page", () => {
    render(<PayButton baseUrl={APP_ORIGIN} link="lnk_abc" />);
    const link = screen.getByRole("link", { name: "Pay with crypto" });
    expect(link.getAttribute("href")).toBe(`${APP_ORIGIN}/l/lnk_abc`);
    expect(link.hasAttribute("aria-haspopup")).toBe(false);
  });

  it("renders a link to the invoice page from the base URL's origin only", () => {
    render(<PayButton baseUrl={`${APP_ORIGIN}/shop?x=1`} invoice="inv_xyz" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe(`${APP_ORIGIN}/pay/inv_xyz`);
  });

  it("shows children as the label and uses the given class instead of the default style", () => {
    render(
      <PayButton baseUrl={APP_ORIGIN} link="lnk_abc" className="my-button">
        Buy now
      </PayButton>,
    );
    const link = screen.getByRole("link", { name: "Buy now" });
    expect(link.className).toBe("my-button");
    expect(link.getAttribute("style")).toBeNull();
  });

  it("uses the default class and inline style without a className", () => {
    render(<PayButton baseUrl={APP_ORIGIN} link="lnk_abc" />);
    const link = screen.getByRole("link");
    expect(link.className).toBe("solverr-pay-button");
    expect(link.style.textDecoration).toBe("none");
  });

  it("adds the stylesheet once for many buttons", () => {
    render(
      <>
        <PayButton baseUrl={APP_ORIGIN} link="lnk_a" />
        <PayButton baseUrl={APP_ORIGIN} link="lnk_b" />
      </>,
    );
    expect(document.querySelectorAll("#solverr-react-styles")).toHaveLength(1);
  });
});

describe("invalid setup", () => {
  it.each([
    ["no base URL", { link: "lnk_abc" }, /baseUrl/],
    ["an http base URL", { baseUrl: "http://pay.example.com", link: "lnk_abc" }, /https URL/],
    ["an invalid link id", { baseUrl: APP_ORIGIN, link: "lnk_../admin" }, /not a payment link id/],
    ["an empty invoice id", { baseUrl: APP_ORIGIN, invoice: "" }, /not an invoice id/],
  ])("renders a disabled button without aria-haspopup and logs one error for %s", (_label, props, reason) => {
    const { rerender } = render(<PayButton {...props} />);
    rerender(<PayButton {...props} />);
    const button = screen.getByRole("button", { name: "Pay with crypto" });
    expect(button).toHaveProperty("disabled", true);
    expect(button.hasAttribute("aria-haspopup")).toBe(false);
    expect(screen.queryByRole("link")).toBeNull();
    expect(consoleError).toHaveBeenCalledOnce();
    expect(String(consoleError.mock.calls[0]?.[0])).toMatch(reason);
    expect(String(consoleError.mock.calls[0]?.[0])).toMatch(/^Solverr PayButton: /);
  });

  it("renders a disabled overlay button that opens nothing", () => {
    render(<PayButton mode="overlay" baseUrl="ftp://pay.example.com" link="lnk_abc" />);
    const button = screen.getByRole("button");
    expect(button).toHaveProperty("disabled", true);
    fireEvent.click(button);
    expect(overlayElement()).toBeNull();
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it("logs nothing for a valid setup", () => {
    render(<PayButton baseUrl={APP_ORIGIN} link="lnk_abc" />);
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("overlay mode", () => {
  it("renders a dialog button and opens the checkout overlay on click", () => {
    render(<PayButton baseUrl={APP_ORIGIN} invoice="inv_1" mode="overlay" />);
    const button = screen.getByRole("button", { name: "Pay with crypto" });
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(overlayElement()).toBeNull();
    fireEvent.click(button);
    expect(overlayElement()?.tagName).toBe("DIALOG");
    expect(overlayElement()?.hasAttribute("open")).toBe(true);
    const src = new URL(checkoutFrame()?.src ?? "");
    expect(src.origin).toBe(APP_ORIGIN);
    expect(src.pathname).toBe("/pay/inv_1");
    expect(src.searchParams.get("embed")).toBe("1");
    expect(src.searchParams.get("origin")).toBe(window.location.origin);
  });

  it("calls onPaid and onClose from the checkout frame, then can open again", () => {
    const onPaid = vi.fn();
    const onClose = vi.fn();
    render(<PayButton baseUrl={APP_ORIGIN} invoice="inv_1" mode="overlay" onPaid={onPaid} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button"));
    const message = paidMessage("inv_1");
    postMessage(message, APP_ORIGIN, frameWindow());
    expect(onPaid).toHaveBeenCalledExactlyOnceWith(message.invoice);
    postMessage(CLOSE_MESSAGE, APP_ORIGIN, frameWindow());
    expect(onClose).toHaveBeenCalledOnce();
    expect(overlayElement()).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(overlayElement()).not.toBeNull();
  });

  it("removes the overlay without calling onClose when the button unmounts", () => {
    const onClose = vi.fn();
    const { unmount } = render(<PayButton baseUrl={APP_ORIGIN} invoice="inv_1" mode="overlay" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button"));
    unmount();
    expect(overlayElement()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("SolverrProvider", () => {
  it("gives every button inside it the base URL", () => {
    render(
      <SolverrProvider baseUrl={APP_ORIGIN}>
        <PayButton link="lnk_a" />
        <PayButton invoice="inv_b" />
      </SolverrProvider>,
    );
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([`${APP_ORIGIN}/l/lnk_a`, `${APP_ORIGIN}/pay/inv_b`]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("is overridden by a baseUrl prop", () => {
    render(
      <SolverrProvider baseUrl="https://outer.example.com">
        <PayButton baseUrl="https://inner.example.com" link="lnk_a" />
      </SolverrProvider>,
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://inner.example.com/l/lnk_a");
  });

  it("opens the overlay on the provider's origin", () => {
    render(
      <SolverrProvider baseUrl="http://localhost:3000">
        <PayButton link="lnk_a" mode="overlay" />
      </SolverrProvider>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(new URL(checkoutFrame()?.src ?? "").origin).toBe("http://localhost:3000");
  });
});
