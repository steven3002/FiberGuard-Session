/**
 * Fixed-point decimal arithmetic for monetary amounts.
 *
 * Amounts travel through policy files and the HTTP API as plain decimal strings
 * ("0.5", "1", "100"). All comparison and accumulation happens on BigInt after
 * scale normalization, so IEEE-754 floats never touch a monetary value.
 * Conversion to blockchain base units (u128) happens exclusively through
 * `toBaseUnits`, which is reserved for the Fiber RPC boundary.
 */

const DECIMAL_PATTERN = /^(0|[1-9]\d*)(?:\.(\d+))?$/;

/** u128 bound: base-unit values must satisfy 0 <= value < 2^128. */
const U128_MAX = (1n << 128n) - 1n;

const MAX_INTEGER_DIGITS = 39;
const MAX_FRACTIONAL_DIGITS = 18;

export class InvalidAmountError extends Error {
  constructor(value: string, detail: string) {
    super(`Invalid amount "${value}": ${detail}`);
    this.name = "InvalidAmountError";
  }
}

interface FixedPoint {
  /** Value scaled by 10^scale. */
  units: bigint;
  /** Number of fractional digits captured in `units`. */
  scale: number;
}

function parse(value: string): FixedPoint {
  const match = DECIMAL_PATTERN.exec(value);
  if (match === null) {
    throw new InvalidAmountError(
      value,
      "expected a plain non-negative decimal string (no sign, exponent, or leading zeros)",
    );
  }
  const integerPart = match[1] as string;
  const fractionalPart = match[2] ?? "";
  if (integerPart.length > MAX_INTEGER_DIGITS) {
    throw new InvalidAmountError(value, `more than ${MAX_INTEGER_DIGITS} integer digits`);
  }
  if (fractionalPart.length > MAX_FRACTIONAL_DIGITS) {
    throw new InvalidAmountError(value, `more than ${MAX_FRACTIONAL_DIGITS} fractional digits`);
  }
  return { units: BigInt(integerPart + fractionalPart), scale: fractionalPart.length };
}

function rescale(amount: FixedPoint, scale: number): bigint {
  return amount.units * 10n ** BigInt(scale - amount.scale);
}

export function isValidAmount(value: string): boolean {
  try {
    parse(value);
    return true;
  } catch {
    return false;
  }
}

export function isZeroAmount(value: string): boolean {
  return parse(value).units === 0n;
}

export function compareAmounts(a: string, b: string): -1 | 0 | 1 {
  const left = parse(a);
  const right = parse(b);
  const scale = Math.max(left.scale, right.scale);
  const l = rescale(left, scale);
  const r = rescale(right, scale);
  if (l < r) return -1;
  if (l > r) return 1;
  return 0;
}

export function addAmounts(a: string, b: string): string {
  const left = parse(a);
  const right = parse(b);
  const scale = Math.max(left.scale, right.scale);
  return formatFixedPoint(rescale(left, scale) + rescale(right, scale), scale);
}

/**
 * Converts a decimal amount string to integer base units for an asset with the
 * given number of decimals. Rejects amounts with finer precision than the asset
 * supports and results outside the u128 range.
 */
export function toBaseUnits(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_FRACTIONAL_DIGITS) {
    throw new InvalidAmountError(value, `unsupported asset decimals: ${decimals}`);
  }
  const amount = parse(value);
  if (amount.scale > decimals) {
    throw new InvalidAmountError(
      value,
      `has ${amount.scale} fractional digits but the asset supports ${decimals}`,
    );
  }
  const units = rescale(amount, decimals);
  if (units > U128_MAX) {
    throw new InvalidAmountError(value, "exceeds the u128 range in base units");
  }
  return units;
}

export function fromBaseUnits(units: bigint, decimals: number): string {
  if (units < 0n) {
    throw new InvalidAmountError(units.toString(), "base units must be non-negative");
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_FRACTIONAL_DIGITS) {
    throw new InvalidAmountError(units.toString(), `unsupported asset decimals: ${decimals}`);
  }
  return formatFixedPoint(units, decimals);
}

function formatFixedPoint(units: bigint, scale: number): string {
  const digits = units.toString();
  if (scale === 0) {
    return digits;
  }
  const padded = digits.padStart(scale + 1, "0");
  const integerPart = padded.slice(0, padded.length - scale);
  const fractionalPart = padded.slice(padded.length - scale).replace(/0+$/, "");
  return fractionalPart.length > 0 ? `${integerPart}.${fractionalPart}` : integerPart;
}
