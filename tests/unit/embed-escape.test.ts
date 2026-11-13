import { beforeEach, describe, expect, it, vi } from "vitest";

/** The wallet connectors load browser-only code; the embed origin check needs only whether a wallet dialog is open. */
vi.mock("@/lib/wallets/client/connect", () => ({ walletDialogOpen: () => false }));

type FakeWindow = { location: { search: string }; parent: unknown; postMessage: ReturnType<typeof vi.fn> };

const SHOP = "https://shop.example";

/** A checkout frame whose URL carries `search`; its parent is a separate page unless `topLevel`, which makes the frame its own parent. */
function frame(search: string, { topLevel = false } = {}): { window: FakeWindow; parentPostMessage: ReturnType<typeof vi.fn> } {
  const parent = { postMessage: vi.fn() };
  const window: FakeWindow = { location: { search }, parent, postMessage: vi.fn() };
  if (topLevel) window.parent = window;
  vi.stubGlobal("window", window);
  return { window, parentPostMessage: topLevel ? window.postMessage : parent.postMessage };
}

/** A fresh copy of the module, since it keeps the first origin it finds for later pages in the frame. */
const loadEmbedEscape = () => import("@/components/checkout/embed-escape");

beforeEach(() => {
  vi.resetModules();
});

describe("postToEmbedder", () => {
  it("posts close and paid messages to the exact ?origin= of the opener", async () => {
    const { parentPostMessage } = frame(`?origin=${encodeURIComponent(SHOP)}`);
    const { postToEmbedder, embedderOrigin } = await loadEmbedEscape();

    expect(embedderOrigin()).toBe(SHOP);
    postToEmbedder({ type: "close" });
    postToEmbedder({ type: "paid", invoice: { id: "inv_1" } });

    expect(parentPostMessage.mock.calls).toEqual([
      [{ source: "solverr", type: "close" }, SHOP],
      [{ source: "solverr", type: "paid", invoice: { id: "inv_1" } }, SHOP],
    ]);
  });

  it("keeps the opener's origin after the frame moves to a page without it", async () => {
    const { window, parentPostMessage } = frame(`?origin=${encodeURIComponent(SHOP)}`);
    const { postToEmbedder, embedderOrigin } = await loadEmbedEscape();
    embedderOrigin();
    window.location.search = "";

    postToEmbedder({ type: "close" });
    expect(parentPostMessage).toHaveBeenCalledExactlyOnceWith({ source: "solverr", type: "close" }, SHOP);
  });

  it.each([
    ["a wildcard", "?origin=*"],
    ["a javascript: URL", `?origin=${encodeURIComponent("javascript:alert(1)")}`],
    ["a data: URL", `?origin=${encodeURIComponent("data:text/html,hi")}`],
    ["an origin with a path", `?origin=${encodeURIComponent(`${SHOP}/checkout`)}`],
    ["an origin with a trailing slash", `?origin=${encodeURIComponent(`${SHOP}/`)}`],
    ["an empty value", "?origin="],
    ["no origin parameter", ""],
  ])("posts nothing for %s", async (_, search) => {
    const { parentPostMessage } = frame(search);
    const { postToEmbedder, embedderOrigin } = await loadEmbedEscape();

    expect(embedderOrigin()).toBeUndefined();
    postToEmbedder({ type: "close" });
    postToEmbedder({ type: "paid", invoice: { id: "inv_1" } });
    expect(parentPostMessage).not.toHaveBeenCalled();
  });

  it("posts nothing when the checkout is not in a frame (window.parent === window)", async () => {
    const { parentPostMessage } = frame(`?origin=${encodeURIComponent(SHOP)}`, { topLevel: true });
    const { postToEmbedder } = await loadEmbedEscape();

    postToEmbedder({ type: "close" });
    expect(parentPostMessage).not.toHaveBeenCalled();
  });
});
