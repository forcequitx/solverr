import { describe, expect, it } from "vitest";
import { bestCovered } from "@/lib/merchants/settlement-recommendation";

const coverage = (scores: Record<string, number | undefined>) => (name: string) => scores[name];

describe("bestCovered", () => {
  it("picks the candidate with the highest coverage", () => {
    expect(bestCovered(["usdc", "usdt", "eth"], coverage({ usdc: 0.8, usdt: 0.6, eth: 0.7 }))).toBe("usdc");
    expect(bestCovered(["usdc", "usdt"], coverage({ usdc: 0.2, usdt: 0.25 }))).toBe("usdt");
  });

  it("ignores candidates without coverage", () => {
    expect(bestCovered(["usdc", "usdt", "eth"], coverage({ usdc: 0.5, eth: 0.4 }))).toBe("usdc");
  });

  it("recommends nothing when fewer than two candidates have coverage", () => {
    expect(bestCovered(["usdc", "usdt"], coverage({ usdc: 0.9 }))).toBeNull();
    expect(bestCovered(["usdc"], coverage({ usdc: 0.9 }))).toBeNull();
    expect(bestCovered([], coverage({}))).toBeNull();
  });

  it("recommends nothing when the leaders are tied", () => {
    expect(bestCovered(["usdc", "usdt", "eth"], coverage({ usdc: 0.7, usdt: 0.7, eth: 0.1 }))).toBeNull();
  });

  it("counts a coverage of zero as measured", () => {
    expect(bestCovered(["usdc", "usdt"], coverage({ usdc: 0, usdt: 0.1 }))).toBe("usdt");
  });
});
