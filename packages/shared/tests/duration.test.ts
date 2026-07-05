import { describe, expect, it } from "vitest";
import { InvalidDurationError, isValidDuration, parseDuration } from "../src/duration.js";

describe("parseDuration", () => {
  it.each([
    ["10m", 600_000],
    ["30s", 30_000],
    ["2h", 7_200_000],
    ["1d", 86_400_000],
    ["500ms", 500],
  ])("parses %s", (value, expected) => {
    expect(parseDuration(value)).toBe(expected);
  });

  it.each(["10", "m", "10 m", "-5m", "0m", "1.5h", "10M", ""])("rejects %j", (value) => {
    expect(() => parseDuration(value)).toThrow(InvalidDurationError);
    expect(isValidDuration(value)).toBe(false);
  });
});
