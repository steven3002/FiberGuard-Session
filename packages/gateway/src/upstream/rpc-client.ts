/**
 * Minimal JSON-RPC 2.0 client for the Fiber node. Fiber expects a single POST
 * endpoint with `params` as a one-element array wrapping a named-field object
 * (confirmed against the node's bruno e2e payloads). Every failure mode —
 * transport, non-2xx, non-JSON, or a JSON-RPC `error` member — is surfaced as
 * an {@link UpstreamError} so the decision pipeline can map it to
 * UPSTREAM_FIBER_ERROR without leaking transport details to callers.
 */

export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

interface JsonRpcResponse {
  result?: unknown;
  error?: { code: number; message: string };
}

export class JsonRpcClient {
  private nextId = 1;

  constructor(private readonly endpoint: string) {}

  async call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params: [params] });

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      });
    } catch (error) {
      throw new UpstreamError(`request to Fiber node failed: ${(error as Error).message}`, {
        method,
      });
    }

    if (!response.ok) {
      throw new UpstreamError(`Fiber node returned HTTP ${response.status}`, {
        method,
        status: response.status,
      });
    }

    let body: JsonRpcResponse;
    try {
      body = (await response.json()) as JsonRpcResponse;
    } catch {
      throw new UpstreamError("Fiber node returned a non-JSON response", { method });
    }

    if (body.error !== undefined) {
      throw new UpstreamError(`Fiber node error: ${body.error.message}`, {
        method,
        code: body.error.code,
      });
    }
    return body.result;
  }
}
