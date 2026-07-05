import { asBlocked, FiberGuardError, HttpClient } from "./http.js";
import { fromWirePermission, toWirePermission } from "./mapping.js";
import { Session, type SessionContext } from "./session.js";
import type { FetchLike, FiberGuardConfig, PermissionRequest } from "./types.js";

/**
 * Entry point for the FiberGuard SDK. Bind it to a gateway URL, app id, and
 * origin, then open sessions and drive intents. Isomorphic: uses the global
 * `fetch` in browsers and Node 20, or an injected implementation.
 */
export class FiberGuard {
  private readonly http: HttpClient;
  private readonly ctx: SessionContext;

  constructor(config: FiberGuardConfig) {
    const fetchImpl = config.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
    if (fetchImpl === undefined) {
      throw new FiberGuardError("no fetch implementation available; pass config.fetch");
    }
    this.http = new HttpClient(config.gatewayUrl, fetchImpl);
    this.ctx = { http: this.http, appId: config.appId, origin: config.origin };
  }

  /**
   * Opens a session. Resolves to a {@link Session} handle — active immediately
   * when policy auto-approves, otherwise pending (`session.approvalUrl` +
   * `session.waitForApproval()`). A policy-refused request throws
   * {@link FiberGuardError} carrying the decision reason.
   */
  async requestSession(input: { permissions: PermissionRequest[] }): Promise<Session> {
    const response = await this.http.post("/session/request", {
      app_id: this.ctx.appId,
      origin: this.ctx.origin,
      requested_permissions: input.permissions.map(toWirePermission),
    });
    const blocked = asBlocked(response.body);
    if (blocked !== null) {
      throw new FiberGuardError(
        `session request blocked: ${blocked.reason}`,
        blocked.reason,
        blocked.details,
      );
    }

    const body = response.body;
    if (body.status === "pending_approval") {
      return new Session(this.ctx, {
        status: "pending_approval",
        ...(typeof body.session_request_id === "string"
          ? { sessionRequestId: body.session_request_id }
          : {}),
        ...(typeof body.approval_url === "string" ? { approvalUrl: body.approval_url } : {}),
      });
    }
    if (body.status === "approved" && typeof body.session_id === "string") {
      return new Session(this.ctx, {
        status: "approved",
        sessionId: body.session_id,
        ...(typeof body.expires_at === "string" ? { expiresAt: body.expires_at } : {}),
      });
    }
    throw new FiberGuardError("unexpected session request response");
  }

  /**
   * Looks up an existing session by id. Resolves to an active {@link Session}
   * handle, or `null` when the gateway reports SESSION_NOT_FOUND.
   */
  async getCurrentSession(sessionId: string): Promise<Session | null> {
    const response = await this.http.get(
      `/session/current?session_id=${encodeURIComponent(sessionId)}`,
    );
    const blocked = asBlocked(response.body);
    if (blocked !== null) {
      if (blocked.reason === "SESSION_NOT_FOUND") {
        return null;
      }
      throw new FiberGuardError(
        `current session blocked: ${blocked.reason}`,
        blocked.reason,
        blocked.details,
      );
    }

    const body = response.body;
    if (typeof body.session_id === "string") {
      return new Session(this.ctx, {
        status: "approved",
        sessionId: body.session_id,
        ...(typeof body.expires_at === "string" ? { expiresAt: body.expires_at } : {}),
        permissions: Array.isArray(body.permissions)
          ? body.permissions.map((permission) =>
              fromWirePermission(permission as Record<string, unknown>),
            )
          : [],
      });
    }
    throw new FiberGuardError("unexpected current-session response");
  }
}

export { Session } from "./session.js";
export { FiberGuardError } from "./http.js";
export type * from "./types.js";
