import type { DecisionReason, FiberGuardAction } from "@fiberguard/shared";

export type { DecisionReason, FiberGuardAction };

/**
 * Minimal structural subset of the Fetch API the SDK relies on, so it stays
 * isomorphic (browser + Node 20 global `fetch`) without pulling in DOM lib
 * types. Callers may inject their own implementation for testing.
 */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface FiberGuardConfig {
  gatewayUrl: string;
  appId: string;
  origin: string;
  /** Defaults to the global `fetch`. Inject to test or to target a custom transport. */
  fetch?: FetchLike;
}

/** A permission requested when opening a session (camelCase; mapped to the wire). */
export interface PermissionRequest {
  action: FiberGuardAction;
  asset?: string;
  maxAmountPerPayment?: string;
  maxAmountPerInvoice?: string;
  dailyLimit?: string;
  expiresIn?: string;
}

/** A permission actually granted on a session, already policy-clamped. */
export interface GrantedPermission {
  action: FiberGuardAction;
  asset?: string;
  maxAmountPerPayment?: string;
  maxAmountPerInvoice?: string;
  dailyLimit?: string;
}

/** Every intent method resolves to an allowed result or this typed block (never throws). */
export interface BlockedResult {
  decision: "blocked";
  reason: DecisionReason;
  details?: Record<string, unknown>;
}

export interface PaymentResult {
  decision: "allowed";
  status: "forwarded";
  paymentHash: string;
  fiberResult: Record<string, unknown>;
}

export interface InvoiceResult {
  decision: "allowed";
  status: "forwarded";
  invoiceAddress: string;
  fiberResult: Record<string, unknown>;
}

export interface PaymentReadResult {
  decision: "allowed";
  paymentHash: string;
  state: string;
}

export interface ChannelSummaryResult {
  decision: "allowed";
  totalChannels: number;
  openChannels: number;
  closedChannels: number;
}

export interface NodeInfoResult {
  decision: "allowed";
  node: Record<string, unknown>;
}

export interface ActionResult {
  decision: "allowed";
  status: string;
  fiberResult?: Record<string, unknown>;
}

export interface RevokeResult {
  decision: "allowed";
  status: "revoked";
}

export type SessionStatus = "pending_approval" | "approved" | "denied";

export interface PayInvoiceInput {
  invoice: string;
  asset: string;
  amount: string;
  reason?: string;
}

export interface CreateInvoiceInput {
  asset: string;
  amount: string;
  description?: string;
}

export interface WaitForApprovalOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

/** A decision/lifecycle event from the gateway audit log (camelCase). */
export interface AuditEntry {
  event: string;
  appId?: string;
  origin?: string;
  sessionId?: string;
  action?: string;
  asset?: string;
  requestedAmount?: string;
  decision: "allowed" | "blocked";
  reason: DecisionReason;
  timestamp: string;
}

export interface GetAuditOptions {
  appId?: string;
  limit?: number;
}
