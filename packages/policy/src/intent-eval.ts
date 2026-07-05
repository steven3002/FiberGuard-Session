import {
  addAmounts,
  compareAmounts,
  type DecisionReason,
  type FiberGuardAction,
  type GrantedPermission,
} from "@fiberguard/shared";
import type { Policy } from "./schema.js";

export type PolicySessionStatus = "pending_approval" | "active" | "revoked";

/**
 * Engine-facing view of a stored session. The gateway adapts its persisted
 * session records into this shape; the engine never touches storage or clocks.
 */
export interface PolicySessionSnapshot {
  sessionId: string;
  appId: string;
  origin: string;
  status: PolicySessionStatus;
  approvalType: "session" | "once";
  /** True once a one-shot session has performed its single allowed intent. */
  used: boolean;
  /** ISO 8601 expiry instant. */
  expiresAt: string;
  permissions: GrantedPermission[];
}

export interface IntentRequest {
  action: FiberGuardAction;
  asset?: string;
  /** Decimal amount string; required for payment and invoice intents. */
  amount?: string;
  /** For payment.read_own: whether the target payment belongs to this session. */
  paymentOwnedBySession?: boolean;
}

export type IntentDecision =
  | { decision: "allowed"; reason: "WITHIN_POLICY"; permission: GrantedPermission }
  | { decision: "blocked"; reason: DecisionReason; details?: Record<string, unknown> };

function block(reason: DecisionReason, details?: Record<string, unknown>): IntentDecision {
  return details === undefined
    ? { decision: "blocked", reason }
    : { decision: "blocked", reason, details };
}

export interface EvaluateIntentParams {
  policy: Policy;
  appId: string;
  origin: string;
  session: PolicySessionSnapshot | null;
  intent: IntentRequest;
  now: Date;
  /** Accumulated spend today (UTC) for this app + action + asset, decimal string. */
  spentToday?: string;
}

/**
 * Runs the ordered intent decision checks (app, origin, session state, deny
 * list, action, asset, per-intent cap, daily limit, ownership). The order is
 * normative: the first failing check determines the reason code.
 */
export function evaluateIntent(params: EvaluateIntentParams): IntentDecision {
  const { policy, appId, origin, session, intent, now } = params;

  const app = policy.apps[appId];
  if (app === undefined) {
    return block("APP_NOT_FOUND", { app_id: appId });
  }
  if (!app.origins.includes(origin)) {
    return block("ORIGIN_NOT_ALLOWED", { origin, allowed_origins: app.origins });
  }

  if (session === null) {
    return block("SESSION_NOT_FOUND");
  }
  if (session.appId !== appId || session.origin !== origin) {
    return block("SESSION_NOT_FOUND", { session_id: session.sessionId });
  }
  if (session.status === "pending_approval") {
    return block("SESSION_PENDING_APPROVAL", { session_id: session.sessionId });
  }
  if (Date.parse(session.expiresAt) <= now.getTime()) {
    return block("SESSION_EXPIRED", {
      session_id: session.sessionId,
      expires_at: session.expiresAt,
    });
  }
  if (session.status === "revoked") {
    return block("SESSION_REVOKED", { session_id: session.sessionId });
  }
  if (session.approvalType === "once" && session.used) {
    return block("SESSION_EXPIRED", { session_id: session.sessionId, consumed: true });
  }

  if (app.deny.some((rule) => rule.action === intent.action)) {
    return block("ACTION_EXPLICITLY_DENIED", { action: intent.action });
  }

  const policyStillAllows = app.allow.some((rule) => rule.action === intent.action);
  const actionPermissions = session.permissions.filter(
    (permission) => permission.action === intent.action,
  );
  if (!policyStillAllows || actionPermissions.length === 0) {
    return block("ACTION_NOT_ALLOWED", { action: intent.action });
  }

  const permission = actionPermissions.find((candidate) =>
    intent.asset === undefined ? candidate.asset === undefined : candidate.asset === intent.asset,
  );
  if (permission === undefined) {
    return block("ASSET_NOT_ALLOWED", {
      action: intent.action,
      requested_asset: intent.asset ?? null,
      allowed_assets: actionPermissions
        .map((candidate) => candidate.asset)
        .filter((asset): asset is string => asset !== undefined),
    });
  }

  const cap =
    intent.action === "invoice.create"
      ? permission.max_amount_per_invoice
      : permission.max_amount_per_payment;
  const capField =
    intent.action === "invoice.create" ? "max_amount_per_invoice" : "max_amount_per_payment";
  if (cap !== undefined) {
    if (intent.amount === undefined) {
      return block("INVALID_REQUEST", {
        action: intent.action,
        detail: "amount is required for this action",
      });
    }
    if (compareAmounts(intent.amount, cap) > 0) {
      return block("AMOUNT_EXCEEDS_SESSION_LIMIT", {
        requested_amount: intent.amount,
        [capField]: cap,
        ...(intent.asset !== undefined ? { asset: intent.asset } : {}),
      });
    }
  }

  if (permission.daily_limit !== undefined && intent.amount !== undefined) {
    const spentToday = params.spentToday ?? "0";
    const projected = addAmounts(spentToday, intent.amount);
    if (compareAmounts(projected, permission.daily_limit) > 0) {
      return block("AMOUNT_EXCEEDS_DAILY_LIMIT", {
        requested_amount: intent.amount,
        spent_today: spentToday,
        daily_limit: permission.daily_limit,
        ...(intent.asset !== undefined ? { asset: intent.asset } : {}),
      });
    }
  }

  if (intent.action === "payment.read_own" && intent.paymentOwnedBySession === false) {
    return block("PAYMENT_NOT_OWNED_BY_SESSION");
  }

  return { decision: "allowed", reason: "WITHIN_POLICY", permission };
}
