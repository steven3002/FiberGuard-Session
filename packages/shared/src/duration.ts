/**
 * Parses human-readable duration strings used in policy files and session
 * requests ("10m", "30s", "2h", "1d", "500ms") into milliseconds.
 */

const DURATION_PATTERN = /^(\d{1,9})(ms|s|m|h|d)$/;

const UNIT_TO_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export class InvalidDurationError extends Error {
  constructor(value: string, detail: string) {
    super(`Invalid duration "${value}": ${detail}`);
    this.name = "InvalidDurationError";
  }
}

export function parseDuration(value: string): number {
  const match = DURATION_PATTERN.exec(value);
  if (match === null) {
    throw new InvalidDurationError(
      value,
      'expected "<positive integer><ms|s|m|h|d>", e.g. "10m"',
    );
  }
  const quantity = Number(match[1]);
  if (quantity === 0) {
    throw new InvalidDurationError(value, "duration must be greater than zero");
  }
  return quantity * (UNIT_TO_MS[match[2] as string] as number);
}

export function isValidDuration(value: string): boolean {
  try {
    parseDuration(value);
    return true;
  } catch {
    return false;
  }
}
