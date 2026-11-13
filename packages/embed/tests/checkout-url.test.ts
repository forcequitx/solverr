import { describe, expect, it } from "vitest";
import { appOrigin, checkoutUrl } from "../src/core.js";

describe("appOrigin", () => {
  it.each([
    ["https://pay.example.com", "https://pay.example.com"],
    ["https://pay.example.com/some/path?x=1", "https://pay.example.com"],
    ["https://pay.example.com:8443", "https://pay.example.com:8443"],
    ["http://localhost:3000", "http://localhost:3000"],
    ["http://127.0.0.1:3000", "http://127.0.0.1:3000"],
    ["http://[::1]:3000", "http://[::1]:3000"],
  ])("reads the origin of %s", (baseUrl, origin) => {
    expect(appOrigin(baseUrl)).toBe(origin);
  });

  it.each(["http://pay.example.com", "http://localhost.example.com", "ftp://pay.example.com", "javascript:alert(1)", "data:text/html,x"])(
    "refuses %s",
    (baseUrl) => {
      expect(() => appOrigin(baseUrl)).toThrow(/https URL/);
    },
  );

  it("refuses a value that is not a URL", () => {
    expect(() => appOrigin("pay.example.com")).toThrow(TypeError);
  });
});

describe("checkoutUrl", () => {
  const origin = "https://pay.example.com";

  it("builds the payment link page", () => {
    expect(checkoutUrl(origin, { link: "lnk_Abc123" }, "page").href).toBe("https://pay.example.com/l/lnk_Abc123");
  });

  it("builds the invoice page", () => {
    expect(checkoutUrl(origin, { invoice: "inv_Xyz789" }, "page").href).toBe("https://pay.example.com/pay/inv_Xyz789");
  });

  it("adds embed=1 and this page's origin in overlay mode", () => {
    const url = checkoutUrl(origin, { invoice: "inv_1" }, "overlay");
    expect(url.origin).toBe(origin);
    expect(url.pathname).toBe("/pay/inv_1");
    expect(url.searchParams.get("embed")).toBe("1");
    expect(url.searchParams.get("origin")).toBe(window.location.origin);
  });

  it("adds nothing to the URL in page mode", () => {
    expect(checkoutUrl(origin, { link: "lnk_1" }, "page").search).toBe("");
  });

  it("accepts an id of 64 characters after the prefix", () => {
    expect(() => checkoutUrl(origin, { link: `lnk_${"a".repeat(64)}` }, "page")).not.toThrow();
  });

  it.each([
    "lnk_",
    `lnk_${"a".repeat(65)}`,
    "lnk_../../admin",
    "lnk_a/b",
    "lnk_a?x=1",
    "lnk_a#x",
    "lnk_a b",
    "inv_123",
    "LNK_abc",
    "",
  ])("refuses the link id %j", (link) => {
    expect(() => checkoutUrl(origin, { link }, "page")).toThrow(/not a payment link id/);
  });

  it.each(["inv_", "inv_../x", "inv_a/b", "lnk_123", "inv_a%2F", "", " inv_1"])("refuses the invoice id %j", (invoice) => {
    expect(() => checkoutUrl(origin, { invoice }, "page")).toThrow(/not an invoice id/);
  });
});
