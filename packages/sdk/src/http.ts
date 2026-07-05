import type { BlockedResult, DecisionReason, FetchLike } from "./types.js";

/**
 * Thrown for transport-level failures the caller cannot act on as a policy
 * decision: network errors, non-JSON responses, and unexpected shapes (e.g. a
 * bare 5xx crash with no blocked envelope). Policy blocks — including
 * UPSTREAM_FIBER_ERROR served at HTTP 502 — are NOT thrown; they are returned
 * as {@link BlockedResult}. When a session request is refused, `reason` carries
 * the gateway's decision reason.
 */
export class FiberGuardError extends Error {
  constructor(
    message: string,
    public readonly reason?: DecisionReason,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "FiberGuardError";
  }
}

export interface GatewayResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

export class HttpClient {
  constructor(
    private readonly gatewayUrl: string,
    private readonly fetchImpl: FetchLike,
  ) {}

  post(path: string, body: unknown): Promise<GatewayResponse> {
    return this.request("POST", path, body);
  }

  get(path: string): Promise<GatewayResponse> {
    return this.request("GET", path);
  }

  private async request(method: string, path: string, body?: unknown): Promise<GatewayResponse> {
    let response: { status: number; json(): Promise<unknown> };
    try {
      response = await this.fetchImpl(`${this.gatewayUrl}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      throw new FiberGuardError(`network error calling ${method} ${path}: ${(error as Error).message}`);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new FiberGuardError(`gateway returned a non-JSON response for ${method} ${path}`);
    }
    if (typeof json !== "object" || json === null) {
      throw new FiberGuardError(`gateway returned an unexpected response for ${method} ${path}`);
    }
    return { statusCode: response.status, body: json as Record<string, unknown> };
  }
}

/** Reads a gateway body as a typed block, or null when it is an allowed envelope. */
export function asBlocked(body: Record<string, unknown>): BlockedResult | null {
  if (body.status === "blocked" && typeof body.reason === "string") {
    return {
      decision: "blocked",
      reason: body.reason as DecisionReason,
      ...(body.details !== undefined
        ? { details: body.details as Record<string, unknown> }
        : {}),
    };
  }
  return null;
}

/**
 * Classifies a gateway response by envelope, not HTTP status: a blocked
 * envelope becomes a typed {@link BlockedResult} (even at 502 for
 * UPSTREAM_FIBER_ERROR); a recognized allowed body is mapped; anything else is
 * a genuine fault and throws {@link FiberGuardError}.
 */
export function interpret<T>(
  response: GatewayResponse,
  mapAllowed: (body: Record<string, unknown>) => T | null,
): T | BlockedResult {
  const blocked = asBlocked(response.body);
  if (blocked !== null) {
    return blocked;
  }
  const allowed = mapAllowed(response.body);
  if (allowed !== null) {
    return allowed;
  }
  throw new FiberGuardError(`unexpected gateway response (HTTP ${response.statusCode})`);
}
