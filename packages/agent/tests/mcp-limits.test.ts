import { describe, expect, it } from "vitest";
import type { SpendingLimits } from "../src/limits.js";
import { limitsWithinCeiling } from "../src/mcp-server.js";

const ceiling: SpendingLimits = { perPaymentUsd: 2, dailyUsd: 10, allow: ["api.example.com", "*.data.example.com"] };
const lowered: SpendingLimits = { perPaymentUsd: 1, dailyUsd: 5, allow: ["api.example.com"] };

describe("set_limits ceiling", () => {
  it("lowers limits and narrows the allow list", () => {
    expect(limitsWithinCeiling(ceiling, { perPaymentUsd: 0.5, dailyUsd: 3, allow: ["a.data.example.com"] }, ceiling)).toEqual({
      perPaymentUsd: 0.5,
      dailyUsd: 3,
      allow: ["a.data.example.com"],
    });
  });

  it("keeps the current values for fields that are not given", () => {
    expect(limitsWithinCeiling(lowered, { dailyUsd: 4 }, ceiling)).toEqual({ ...lowered, dailyUsd: 4 });
  });

  it("raises a lowered limit back up to, but not above, the startup value", () => {
    expect(limitsWithinCeiling(lowered, { perPaymentUsd: 2, dailyUsd: 10 }, ceiling)).toMatchObject({ perPaymentUsd: 2, dailyUsd: 10 });
    expect(() => limitsWithinCeiling(lowered, { perPaymentUsd: 2.01 }, ceiling)).toThrow("per_payment_usd cannot be above $2");
    expect(() => limitsWithinCeiling(lowered, { dailyUsd: 10.5 }, ceiling)).toThrow("daily_usd cannot be above $10");
  });

  it.each([
    ["*.data.example.com"],
    ["*.deep.data.example.com"],
    ["x.y.data.example.com"],
    ["API.Example.com"],
  ])("accepts the host pattern %s, which the startup list already covers", (pattern) => {
    expect(limitsWithinCeiling(ceiling, { allow: [pattern] }, ceiling).allow).toEqual([pattern]);
  });

  it.each([
    ["a new host", "evil.example.net"],
    ["the bare domain of a wildcard", "data.example.com"],
    ["a wider wildcard", "*.example.com"],
    ["subdomains of an exact host", "*.api.example.com"],
    ["a lookalike domain", "evildata.example.com"],
    ["a bare star", "*"],
  ])("refuses %s in the allow list", (_name, pattern) => {
    expect(() => limitsWithinCeiling(lowered, { allow: ["api.example.com", pattern] }, ceiling)).toThrow("allow can only contain hosts from the startup allow list");
  });
});
