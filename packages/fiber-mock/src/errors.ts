/**
 * A JSON-RPC 2.0 error surfaced to the caller as an `error` member. Codes follow
 * the JSON-RPC reserved ranges for protocol errors and use an application code
 * (-320xx) for domain failures such as an unknown payment hash.
 */
export class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}
