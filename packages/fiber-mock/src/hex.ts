/**
 * Fiber JSON-RPC encodes u128/u64/u32 integers as 0x-prefixed hexadecimal
 * strings, in request params and results alike (confirmed against the node's
 * bruno e2e payloads: new_invoice `amount:"0xc8"`, send_payment `amount:"0x190"`).
 * These helpers are the mock's only integer <-> wire conversion point.
 */

export function toHex(value: bigint): string {
  if (value < 0n) {
    throw new RangeError(`cannot hex-encode a negative integer: ${value}`);
  }
  return `0x${value.toString(16)}`;
}

export function fromHex(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new TypeError(`expected a 0x-prefixed hex string, received ${JSON.stringify(value)}`);
  }
  return BigInt(value);
}
