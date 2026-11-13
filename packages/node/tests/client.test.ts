import { afterEach, describe, expect, it, vi } from "vitest";
import { Solverr } from "../src/index.js";
import { API_KEY, json, mockFetch } from "./fetch-mock.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Solverr constructor", () => {
  it("accepts a live API key and an https base URL", () => {
    expect(() => new Solverr({ apiKey: API_KEY, baseUrl: "https://pay.example.com" })).not.toThrow();
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["a test key", "sk_test_abc"],
    ["a publishable key", "pk_live_abc"],
    ["only the prefix", "sk_live_"],
    ["a key with whitespace", "sk_live_abc def"],
    ["a key with a line break", "sk_live_abc\r\nx-evil: 1"],
    ["a key with a non-ASCII character", "sk_live_abcé"],
  ])("refuses an API key that is %s", (_label, apiKey) => {
    expect(() => new Solverr({ apiKey, baseUrl: "https://pay.example.com" })).toThrow(/sk_live_/);
  });

  it.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000", "https://pay.example.com/solverr"])(
    "accepts the base URL %s",
    (baseUrl) => {
      expect(() => new Solverr({ apiKey: API_KEY, baseUrl })).not.toThrow();
    },
  );

  it.each(["http://pay.example.com", "http://localhost.example.com", "http://10.0.0.1", "ftp://pay.example.com", "javascript:alert(1)"])(
    "refuses the base URL %s",
    (baseUrl) => {
      expect(() => new Solverr({ apiKey: API_KEY, baseUrl })).toThrow(/https URL/);
    },
  );

  it("refuses a base URL that does not parse", () => {
    expect(() => new Solverr({ apiKey: API_KEY, baseUrl: "not a url" })).toThrow(/not a valid URL/);
  });

  it("reads the base URL from SOLVERR_URL when none is passed", async () => {
    vi.stubEnv("SOLVERR_URL", "https://env.example.com");
    const { calls } = mockFetch(json({ id: "inv_1" }));
    await new Solverr({ apiKey: API_KEY }).invoices.retrieve("inv_1");
    expect(calls[0]?.url).toBe("https://env.example.com/api/v1/invoices/inv_1");
  });

  it("asks for a base URL when neither the option nor SOLVERR_URL is set", () => {
    vi.stubEnv("SOLVERR_URL", "");
    expect(() => new Solverr({ apiKey: API_KEY })).toThrow(/SOLVERR_URL/);
  });

  it("keeps the base URL's path in front of every API path", async () => {
    const { calls } = mockFetch(json({ id: "inv_1" }));
    await new Solverr({ apiKey: API_KEY, baseUrl: "https://example.com/solverr/" }).invoices.retrieve("inv_1");
    expect(calls[0]?.url).toBe("https://example.com/solverr/api/v1/invoices/inv_1");
  });
});
