import { asBlocked, FiberGuardError, HttpClient, interpret } from "./http.js";
import {
  mapAction,
  mapChannelSummary,
  mapInvoice,
  mapNodeInfo,
  mapPayment,
  mapPaymentRead,
} from "./mapping.js";
import type {
  ActionResult,
  BlockedResult,
  ChannelSummaryResult,
  CreateInvoiceInput,
  FiberGuardAction,
  GrantedPermission,
  InvoiceResult,
  NodeInfoResult,
  PayInvoiceInput,
  PaymentReadResult,
  PaymentResult,
  RevokeResult,
  SessionStatus,
  WaitForApprovalOptions,
} from "./types.js";

export interface SessionContext {
  http: HttpClient;
  appId: string;
  origin: string;
}

export interface SessionInit {
  status: SessionStatus;
  sessionId?: string;
  sessionRequestId?: string;
  approvalUrl?: string;
  expiresAt?: string;
  permissions?: GrantedPermission[];
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A session handle. Intent methods resolve to a typed allowed result or a
 * {@link BlockedResult} — never a thrown policy error. While a session is
 * pending approval it has no id yet: intents short-circuit to a typed
 * SESSION_PENDING_APPROVAL block until {@link Session.waitForApproval} resolves.
 */
export class Session {
  status: SessionStatus;
  sessionId?: string;
  sessionRequestId?: string;
  approvalUrl?: string;
  expiresAt?: string;
  permissions: GrantedPermission[];

  constructor(
    private readonly ctx: SessionContext,
    init: SessionInit,
  ) {
    this.status = init.status;
    this.sessionId = init.sessionId;
    this.sessionRequestId = init.sessionRequestId;
    this.approvalUrl = init.approvalUrl;
    this.expiresAt = init.expiresAt;
    this.permissions = init.permissions ?? [];
  }

  /** True once the session has an id and can drive intents. */
  get isActive(): boolean {
    return this.sessionId !== undefined;
  }

  private gate(): BlockedResult | null {
    if (this.sessionId !== undefined) {
      return null;
    }
    return {
      decision: "blocked",
      reason: this.status === "denied" ? "APPROVAL_REQUIRED" : "SESSION_PENDING_APPROVAL",
      ...(this.approvalUrl !== undefined ? { details: { approval_url: this.approvalUrl } } : {}),
    };
  }

  /**
   * Polls the session request until it is approved or denied. On approval the
   * handle gains its session id and becomes active. Throws on timeout.
   */
  async waitForApproval(options: WaitForApprovalOptions = {}): Promise<Session> {
    if (this.sessionId !== undefined) {
      return this;
    }
    if (this.sessionRequestId === undefined) {
      throw new FiberGuardError("session has no pending request to wait for");
    }
    const intervalMs = options.intervalMs ?? 1000;
    const deadline = Date.now() + (options.timeoutMs ?? 120_000);

    for (;;) {
      const { body } = await this.ctx.http.get(
        `/session/request/${encodeURIComponent(this.sessionRequestId)}`,
      );
      if (body.status === "approved") {
        this.status = "approved";
        if (typeof body.session_id === "string") {
          this.sessionId = body.session_id;
        }
        return this;
      }
      if (body.status === "denied") {
        this.status = "denied";
        return this;
      }
      if (Date.now() >= deadline) {
        throw new FiberGuardError(`approval timed out for ${this.sessionRequestId}`);
      }
      await delay(intervalMs);
    }
  }

  async payInvoice(input: PayInvoiceInput): Promise<PaymentResult | BlockedResult> {
    const blocked = this.gate();
    if (blocked !== null) {
      return blocked;
    }
    const response = await this.ctx.http.post("/intent/pay-invoice", {
      session_id: this.sessionId,
      app_id: this.ctx.appId,
      origin: this.ctx.origin,
      invoice: input.invoice,
      asset: input.asset,
      amount: input.amount,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
    });
    return interpret(response, mapPayment);
  }

  async createInvoice(input: CreateInvoiceInput): Promise<InvoiceResult | BlockedResult> {
    const blocked = this.gate();
    if (blocked !== null) {
      return blocked;
    }
    const response = await this.ctx.http.post("/intent/create-invoice", {
      session_id: this.sessionId,
      app_id: this.ctx.appId,
      origin: this.ctx.origin,
      asset: input.asset,
      amount: input.amount,
      ...(input.description !== undefined ? { description: input.description } : {}),
    });
    return interpret(response, mapInvoice);
  }

  async getPayment(paymentHash: string): Promise<PaymentReadResult | BlockedResult> {
    const blocked = this.gate();
    if (blocked !== null) {
      return blocked;
    }
    const response = await this.ctx.http.get(
      `/payments/${encodeURIComponent(paymentHash)}?session_id=${encodeURIComponent(this.sessionId as string)}`,
    );
    return interpret(response, mapPaymentRead);
  }

  async getChannelSummary(): Promise<ChannelSummaryResult | BlockedResult> {
    const blocked = this.gate();
    if (blocked !== null) {
      return blocked;
    }
    const response = await this.ctx.http.get(
      `/channels/summary?session_id=${encodeURIComponent(this.sessionId as string)}`,
    );
    return interpret(response, mapChannelSummary);
  }

  async getNodeInfo(): Promise<NodeInfoResult | BlockedResult> {
    const blocked = this.gate();
    if (blocked !== null) {
      return blocked;
    }
    const response = await this.ctx.http.get(
      `/node/info?session_id=${encodeURIComponent(this.sessionId as string)}`,
    );
    return interpret(response, mapNodeInfo);
  }

  /** Drives a non-implemented (restricted) action through the pipeline; always blocks. */
  async tryAction(
    action: FiberGuardAction,
    params?: Record<string, unknown>,
  ): Promise<ActionResult | BlockedResult> {
    const blocked = this.gate();
    if (blocked !== null) {
      return blocked;
    }
    const response = await this.ctx.http.post("/intent/action", {
      session_id: this.sessionId,
      app_id: this.ctx.appId,
      origin: this.ctx.origin,
      action,
      ...(params !== undefined ? { params } : {}),
    });
    return interpret(response, mapAction);
  }

  async revoke(): Promise<RevokeResult | BlockedResult> {
    const blocked = this.gate();
    if (blocked !== null) {
      return blocked;
    }
    const response = await this.ctx.http.post("/session/revoke", { session_id: this.sessionId });
    const stillBlocked = asBlocked(response.body);
    if (stillBlocked !== null) {
      return stillBlocked;
    }
    if (response.body.status === "revoked") {
      // Local status is left as-is; the gateway is the source of truth and a
      // subsequent intent on this handle returns SESSION_REVOKED.
      return { decision: "allowed", status: "revoked" };
    }
    throw new FiberGuardError("unexpected revoke response");
  }
}
