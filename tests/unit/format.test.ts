import { describe, expect, it } from "vitest";
import {
  amountGroups,
  coinAmount,
  formatAmount,
  formatCount,
  formatShortAmount,
  formatUsd,
  formatUsdCompact,
  formatUtcDate,
  formatUtcDateTime,
  formatWait,
  initials,
  share,
} from "@/lib/format";

describe("amountGroups", () => {
  it("keeps whole numbers and amounts of up to 8 decimals in one piece", () => {
    expect(amountGroups("4.513509")).toEqual(["4.513509"]);
    expect(amountGroups("0.00006543")).toEqual(["0.00006543"]);
    expect(amountGroups("25")).toEqual(["25"]);
  });

  it("splits a 24-decimal amount into groups of 6 that join back into the exact number", () => {
    const groups = amountGroups("1.392073897954128440366972");
    expect(groups).toEqual(["1.392073", "897954", "128440", "366972"]);
    expect(groups.join("")).toBe("1.392073897954128440366972");
  });
});

describe("formatShortAmount", () => {
  it("shows exact amounts with two decimals below 100,000", () => {
    expect(formatShortAmount(1250)).toBe("1,250.00");
    expect(formatShortAmount("99999.99")).toBe("99,999.99");
  });

  it("shortens amounts from 100,000 up with K, M and B", () => {
    expect(formatShortAmount(100_000)).toBe("100K");
    expect(formatShortAmount("1250000")).toBe("1.25M");
    expect(formatShortAmount(2_500_000_000)).toBe("2.5B");
  });

  it("cuts instead of rounding, so a shortened amount never reads as more than it is", () => {
    expect(formatShortAmount(99_999_999.99)).toBe("99.99M");
    expect(formatShortAmount(129_999)).toBe("129.99K");
  });
});

describe("formatAmount", () => {
  it("shows the exact amount with thousands separators", () => {
    expect(formatAmount("1250000")).toBe("1,250,000.00");
    expect(formatAmount(0.5)).toBe("0.50");
  });
});

describe("USD and counts", () => {
  it("formats dollars and axis labels", () => {
    expect(formatUsd(1234.5)).toBe("$1,234.50");
    expect(formatUsdCompact(1_500_000)).toBe("$1.5M");
    expect(formatUsdCompact(500)).toBe("$500");
    expect(formatUsdCompact(0)).toBe("$0");
    expect(formatUsdCompact(0.25)).toBe("$0.25");
    expect(formatUsdCompact(0.5)).toBe("$0.5");
    expect(formatCount(1204)).toBe("1,204");
  });
});

describe("coinAmount", () => {
  it("uses two decimals from 1 coin up and four significant digits below", () => {
    expect(coinAmount(100, { priceUsd: 1 })).toBe("100.00");
    expect(coinAmount(25, { priceUsd: 2500 })).toBe("0.01");
    expect(coinAmount(10, { priceUsd: 3 })).toBe("3.33");
    expect(coinAmount(1, { priceUsd: 97_123 })).toBe("0.0000103");
  });
});

describe("UTC dates", () => {
  it("renders the same text on the server and in the browser", () => {
    expect(formatUtcDate("2026-11-06T23:30:00Z")).toBe("Nov 6, 2026");
    expect(formatUtcDateTime(new Date("2026-11-06T14:05:00Z"))).toBe("Nov 6, 2026, 14:05 UTC");
  });
});

describe("formatWait", () => {
  it("counts seconds up to a minute, then whole minutes rounded up", () => {
    expect(formatWait(1)).toBe("1 second");
    expect(formatWait(45)).toBe("45 seconds");
    expect(formatWait(60)).toBe("1 minute");
    expect(formatWait(61)).toBe("2 minutes");
    expect(formatWait(86_400)).toBe("1440 minutes");
  });
});

describe("share", () => {
  it("gives a whole percent, and 0 for an empty whole", () => {
    expect(share(1, 3)).toBe(33);
    expect(share(2, 3)).toBe(67);
    expect(share(5, 0)).toBe(0);
  });
});

describe("initials", () => {
  it("takes the first letters of the first two words", () => {
    expect(initials("Northwind Coffee Roasters")).toBe("NC");
  });

  it("keeps an apostrophe inside a word", () => {
    expect(initials("Let's do")).toBe("LD");
  });

  it("takes two letters of a single word, in any script", () => {
    expect(initials("solverr")).toBe("SO");
    expect(initials("ümlaut")).toBe("ÜM");
    expect(initials("東京 商店")).toBe("東商");
  });

  it("falls back to a question mark for text without letters", () => {
    expect(initials("")).toBe("?");
    expect(initials("—")).toBe("?");
  });
});
