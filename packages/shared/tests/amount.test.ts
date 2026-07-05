import { describe, expect, it } from "vitest";
import {
  addAmounts,
  compareAmounts,
  fromBaseUnits,
  InvalidAmountError,
  isValidAmount,
  isZeroAmount,
  toBaseUnits,
} from "../src/amount.js";

describe("addAmounts", () => {
  it("adds halves exactly", () => {
    expect(addAmounts("0.5", "0.5")).toBe("1");
  });

  it("avoids float drift on 0.1 + 0.2", () => {
    expect(addAmounts("0.1", "0.2")).toBe("0.3");
  });

  it("handles mixed scales", () => {
    expect(addAmounts("1.05", "0.95")).toBe("2");
    expect(addAmounts("10", "0.001")).toBe("10.001");
  });
});

describe("compareAmounts", () => {
  it("orders across scales", () => {
    expect(compareAmounts("100", "1")).toBe(1);
    expect(compareAmounts("0.5", "1")).toBe(-1);
    expect(compareAmounts("1.0", "1")).toBe(0);
    expect(compareAmounts("0.50", "0.5")).toBe(0);
  });
});

describe("validation", () => {
  it.each(["1e5", "-1", "abc", "01", "1.", ".5", "", "1..2", "+1", "1,5", " 1"])(
    "rejects %j",
    (value) => {
      expect(isValidAmount(value)).toBe(false);
    },
  );

  it.each(["0", "0.5", "1", "100", "1.000000000000000001"])("accepts %j", (value) => {
    expect(isValidAmount(value)).toBe(true);
  });

  it("rejects more than 18 fractional digits", () => {
    expect(isValidAmount("0.0000000000000000001")).toBe(false);
  });

  it("detects zero in any scale", () => {
    expect(isZeroAmount("0")).toBe(true);
    expect(isZeroAmount("0.00")).toBe(true);
    expect(isZeroAmount("0.01")).toBe(false);
  });
});

describe("toBaseUnits", () => {
  it("converts with asset decimals", () => {
    expect(toBaseUnits("0.5", 8)).toBe(50_000_000n);
    expect(toBaseUnits("1", 8)).toBe(100_000_000n);
    expect(toBaseUnits("100", 0)).toBe(100n);
  });

  it("rejects precision finer than the asset supports", () => {
    expect(() => toBaseUnits("1.234567890", 8)).toThrow(InvalidAmountError);
  });

  it("enforces the u128 upper bound", () => {
    const u128Max = ((1n << 128n) - 1n).toString();
    expect(toBaseUnits(u128Max, 0)).toBe((1n << 128n) - 1n);
    expect(() => toBaseUnits((1n << 128n).toString(), 0)).toThrow(InvalidAmountError);
  });
});

describe("fromBaseUnits", () => {
  it("round-trips and trims trailing zeros", () => {
    expect(fromBaseUnits(50_000_000n, 8)).toBe("0.5");
    expect(fromBaseUnits(100_000_000n, 8)).toBe("1");
    expect(fromBaseUnits(0n, 8)).toBe("0");
    expect(fromBaseUnits(1n, 8)).toBe("0.00000001");
  });

  it("rejects negative base units", () => {
    expect(() => fromBaseUnits(-1n, 8)).toThrow(InvalidAmountError);
  });
});
