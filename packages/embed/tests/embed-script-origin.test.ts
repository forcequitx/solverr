import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubBrowser } from "./dom.js";

let browser: ReturnType<typeof stubBrowser>;

beforeEach(() => {
  browser = stubBrowser();
  vi.resetModules();
  delete window.Solverr;
  document.head.innerHTML = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function addScript(src: string, marked = false): void {
  const script = document.createElement("script");
  script.src = src;
  if (marked) script.setAttribute("data-solverr-embed", "");
  document.head.append(script);
}

const loadEmbed = () => import("../src/embed.js");

describe("embed.js origin", () => {
  it("uses the origin of the only script served at /embed.js", async () => {
    addScript("https://cdn.example.com/analytics.js");
    addScript("https://pay.example.com/embed.js?v=1");
    await loadEmbed();
    window.Solverr?.open({ link: "lnk_1" });
    expect(browser.assign).toHaveBeenCalledWith("https://pay.example.com/l/lnk_1");
  });

  it("loads on a page with an element whose id is Solverr", async () => {
    const named = document.createElement("div");
    named.id = "Solverr";
    /** Browsers expose the element as `window.Solverr`; jsdom does not, so the property is set the same way here. */
    Object.defineProperty(window, "Solverr", { value: named, configurable: true, writable: true });
    addScript("https://pay.example.com/embed.js");
    await loadEmbed();
    window.Solverr?.open({ link: "lnk_1" });
    expect(browser.assign).toHaveBeenCalledWith("https://pay.example.com/l/lnk_1");
  });

  it("prefers a tag marked data-solverr-embed, at any path", async () => {
    addScript("https://other.example.com/embed.js");
    addScript("https://pay.example.com/static/solverr.js", true);
    await loadEmbed();
    window.Solverr?.open({ link: "lnk_1" });
    expect(browser.assign).toHaveBeenCalledWith("https://pay.example.com/l/lnk_1");
  });

  it("refuses to guess between two scripts at /embed.js", async () => {
    addScript("https://pay.example.com/embed.js");
    addScript("https://evil.example.com/embed.js");
    await expect(loadEmbed()).rejects.toThrow(/data-solverr-embed/);
    expect(window.Solverr).toBeUndefined();
  });

  it("asks for a script tag when none is found", async () => {
    await expect(loadEmbed()).rejects.toThrow(/<script src>/);
    expect(window.Solverr).toBeUndefined();
  });

  it("refuses a script served over plain http from a public host", async () => {
    addScript("http://pay.example.com/embed.js");
    await expect(loadEmbed()).rejects.toThrow(/https URL/);
  });

  it("accepts http from localhost", async () => {
    addScript("http://localhost:3000/embed.js");
    await loadEmbed();
    window.Solverr?.open({ invoice: "inv_1" });
    expect(browser.assign).toHaveBeenCalledWith("http://localhost:3000/pay/inv_1");
  });
});
