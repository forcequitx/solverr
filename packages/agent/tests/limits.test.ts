import { describe, expect, it } from "vitest";
import { PaymentError } from "../src/errors.js";
import { enforceLimits, isHostAllowed, normalizeLimits } from "../src/limits.js";

const limits = { perPaymentUsd: 5, dailyUsd: 20, allow: ["api.example.com", "*.data.example.com"] };

function codeOf(run: () => void): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(PaymentError);
    return (error as PaymentError).code;
  }
}

describe("normalizeLimits", () => {
  it("lowercases and trims host patterns", () => {
    expect(normalizeLimits({ perPaymentUsd: 1, dailyUsd: 2, allow: [" API.Example.com ", "*.DATA.example.com"] }).allow).toEqual(["api.example.com", "*.data.example.com"]);
  });

  it.each([
    ["a negative per-payment limit", { perPaymentUsd: -1 }],
    ["an infinite daily limit", { dailyUsd: Infinity }],
    ["a NaN daily limit", { dailyUsd: NaN }],
    ["a limit given as text", { perPaymentUsd: "5" as unknown as number }],
    ["an empty host", { allow: ["api.example.com", " "] }],
    ["an allow list that is not a list", { allow: "api.example.com" as unknown as string[] }],
  ])("refuses %s", (_name, change) => {
    expect(() => normalizeLimits({ ...limits, ...change })).toThrow();
  });

  it("accepts zero limits and an empty allow list", () => {
    expect(normalizeLimits({ perPaymentUsd: 0, dailyUsd: 0, allow: [] })).toEqual({ perPaymentUsd: 0, dailyUsd: 0, allow: [] });
  });
});

describe("isHostAllowed", () => {
  it("matches exact hosts case-insensitively", () => {
    expect(isHostAllowed("API.EXAMPLE.COM", limits.allow)).toBe(true);
    expect(isHostAllowed("example.com", limits.allow)).toBe(false);
  });

  it("matches a wildcard on any depth of subdomain but not the bare domain or a lookalike", () => {
    expect(isHostAllowed("a.data.example.com", limits.allow)).toBe(true);
    expect(isHostAllowed("a.b.data.example.com", limits.allow)).toBe(true);
    expect(isHostAllowed("data.example.com", limits.allow)).toBe(false);
    expect(isHostAllowed("evildata.example.com", limits.allow)).toBe(false);
  });

  it("allows nothing with an empty list", () => {
    expect(isHostAllowed("api.example.com", [])).toBe(false);
  });
});

describe("enforceLimits", () => {
  it("allows a payment exactly at the per-payment and daily limits", () => {
    expect(codeOf(() => enforceLimits(limits, { hostname: "api.example.com", amountUsd: 5, spentLast24hUsd: 15 }))).toBeUndefined();
  });

  it("refuses a host off the allow list before checking amounts", () => {
    expect(codeOf(() => enforceLimits(limits, { hostname: "other.example.com", amountUsd: 99, spentLast24hUsd: 99 }))).toBe("host_not_allowed");
  });

  it("refuses a payment above the per-payment limit", () => {
    expect(codeOf(() => enforceLimits(limits, { hostname: "api.example.com", amountUsd: 5.01, spentLast24hUsd: 0 }))).toBe("per_payment_limit");
  });

  it("refuses a payment that would bring the last 24 hours above the daily limit", () => {
    expect(codeOf(() => enforceLimits(limits, { hostname: "api.example.com", amountUsd: 5, spentLast24hUsd: 15.01 }))).toBe("daily_limit");
  });
});
