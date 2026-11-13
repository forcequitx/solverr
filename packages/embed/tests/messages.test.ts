import { describe, expect, it } from "vitest";
import { readCheckoutMessage } from "../src/messages.js";
import { APP_ORIGIN, CLOSE_MESSAGE, paidMessage } from "./dom.js";

/** Any distinct object works as a frame window here: only identity with `event.source` is compared. */
const frame = {} as Window;

function message(data: unknown, origin = APP_ORIGIN, source: unknown = frame): MessageEvent {
  return { data, origin, source } as MessageEvent;
}

describe("readCheckoutMessage", () => {
  it("reads a paid message from the frame on the app origin", () => {
    const paid = paidMessage("inv_9");
    expect(readCheckoutMessage(message(paid), APP_ORIGIN, frame)).toEqual({ type: "paid", invoice: paid.invoice });
  });

  it("reads a close message", () => {
    expect(readCheckoutMessage(message(CLOSE_MESSAGE), APP_ORIGIN, frame)).toEqual({ type: "close" });
  });

  it.each([
    ["another origin", message(CLOSE_MESSAGE, "https://evil.example")],
    ["the app origin over http", message(CLOSE_MESSAGE, "http://pay.example.com")],
    ["another window on the app origin", message(CLOSE_MESSAGE, APP_ORIGIN, {})],
    ["no source window", message(CLOSE_MESSAGE, APP_ORIGIN, null)],
  ])("ignores a message from %s", (_label, event) => {
    expect(readCheckoutMessage(event, APP_ORIGIN, frame)).toBeUndefined();
  });

  it("ignores every message while the frame has no window", () => {
    expect(readCheckoutMessage(message(CLOSE_MESSAGE, APP_ORIGIN, null), APP_ORIGIN, null)).toBeUndefined();
  });

  it.each([
    ["no data", undefined],
    ["a string", "close"],
    ["another source tag", { source: "other", type: "close" }],
    ["an unknown type", { source: "solverr", type: "open" }],
    ["paid without an invoice", { source: "solverr", type: "paid" }],
    ["paid with a numeric invoice id", { source: "solverr", type: "paid", invoice: { id: 1 } }],
  ])("ignores %s", (_label, data) => {
    expect(readCheckoutMessage(message(data), APP_ORIGIN, frame)).toBeUndefined();
  });
});
