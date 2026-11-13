import { describe, expect, it } from "vitest";
import { FIAT_AMOUNT_PATTERN, formatBaseUnits, formatMinimumUsd, mulDivRound, numberToDecimal, toBaseUnits } from "@/lib/money";

describe("toBaseUnits", () => {
  it("converts a decimal string to integer base units", () => {
    expect(toBaseUnits("1.5", 6)).toBe(1_500_000n);
    expect(toBaseUnits("25", 6)).toBe(25_000_000n);
    expect(toBaseUnits("0.000001", 6)).toBe(1n);
  });

  it("drops digits beyond the coin's decimals instead of rounding up", () => {
    expect(toBaseUnits("1.1234569", 6)).toBe(1_123_456n);
    expect(toBaseUnits("12.9", 0)).toBe(12n);
  });

  it("keeps 18-decimal amounts exact beyond the range of a JavaScript number", () => {
    expect(toBaseUnits("123456789.123456789123456789", 18)).toBe(123_456_789_123_456_789_123_456_789n);
  });

  it("accepts zero and leading zeros", () => {
    expect(toBaseUnits("0", 6)).toBe(0n);
    expect(toBaseUnits("007.50", 2)).toBe(750n);
  });

  it.each(["-1", "1e5", ".5", "1.", " 1", "1,000", "", "0x10", "NaN", "Infinity"])("refuses %j", (value) => {
    expect(() => toBaseUnits(value, 6)).toThrow("Not a decimal number");
  });
});

describe("formatBaseUnits", () => {
  it("writes base units as a decimal without trailing zeros", () => {
    expect(formatBaseUnits(1_500_000n, 6)).toBe("1.5");
    expect(formatBaseUnits(25_000_000n, 6)).toBe("25");
    expect(formatBaseUnits(1n, 6)).toBe("0.000001");
    expect(formatBaseUnits(0n, 6)).toBe("0");
    expect(formatBaseUnits(42n, 0)).toBe("42");
  });

  it("round-trips with toBaseUnits", () => {
    for (const value of ["0.1", "1", "999999999999.999999", "0.000000000000000001", "100.05"]) {
      expect(formatBaseUnits(toBaseUnits(value, 18), 18)).toBe(value);
    }
  });
});

describe("numberToDecimal", () => {
  it("writes a number as a plain decimal string", () => {
    expect(numberToDecimal(0.1)).toBe("0.1");
    expect(numberToDecimal(100)).toBe("100");
    expect(numberToDecimal(0)).toBe("0");
    expect(numberToDecimal(1e-7)).toBe("0.0000001");
    expect(numberToDecimal(0.92)).toBe("0.92");
  });

  it("rounds prices finer than 12 decimals to zero", () => {
    expect(numberToDecimal(1e-13)).toBe("0");
    expect(numberToDecimal(4e-12)).toBe("0.000000000004");
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("refuses %s", (value) => {
    expect(() => numberToDecimal(value)).toThrow("Invalid number");
  });
});

describe("mulDivRound", () => {
  it("rounds half up", () => {
    expect(mulDivRound(10n, 1n, 4n)).toBe(3n);
    expect(mulDivRound(5n, 1n, 2n)).toBe(3n);
    expect(mulDivRound(10n, 1n, 3n)).toBe(3n);
    expect(mulDivRound(11n, 1n, 3n)).toBe(4n);
  });

  it("keeps precision for large products", () => {
    expect(mulDivRound(10n ** 30n, 10n ** 18n, 10n ** 12n)).toBe(10n ** 36n);
  });

  it("refuses a zero or negative divisor", () => {
    expect(() => mulDivRound(1n, 1n, 0n)).toThrow("Division by zero");
    expect(() => mulDivRound(1n, 1n, -5n)).toThrow("Division by zero");
  });
});

describe("FIAT_AMOUNT_PATTERN", () => {
  it.each(["25", "25.5", "25.00", "999999999999.99", "0.01"])("accepts %s", (value) => {
    expect(FIAT_AMOUNT_PATTERN.test(value)).toBe(true);
  });

  it.each(["1000000000000", "25.001", "1,000", "-5", "25.", ".5", "1e3"])("refuses %s", (value) => {
    expect(FIAT_AMOUNT_PATTERN.test(value)).toBe(false);
  });
});

describe("formatMinimumUsd", () => {
  it("shows whole dollars without cents and others with two decimals", () => {
    expect(formatMinimumUsd(1000)).toBe("$1,000");
    expect(formatMinimumUsd(4.84)).toBe("$4.84");
    expect(formatMinimumUsd(4.5)).toBe("$4.50");
  });
});
