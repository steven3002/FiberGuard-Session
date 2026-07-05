import {
  InvalidAmountError,
  type DecisionReason,
  type FiberGuardAction,
} from "@fiberguard/shared";
import {
  evaluateIntent,
  type AssetConfig,
  type Policy,
  type PolicySessionSnapshot,
} from "@fiberguard/policy";
import type { AuditWriter } from "../audit/writer.js";
import { blockedBody } from "../../server/responses.js";
import { FiberClient } from "../../upstream/fiber.js";
import { UpstreamError } from "../../upstream/rpc-client.js";
import { SessionStore, type StoredSession } from "../sessions/store.js";
import { OwnershipIndex } from "../ownership/index.js";
import { SpendLedger } from "../spend/ledger.js";

export interface PipelineContext {
  policy: Policy;
  sessionStore: SessionStore;
  spendLedger: SpendLedger;
  ownership: OwnershipIndex;
  fiber: FiberClient;
  audit: AuditWriter;
}

/**
 * A normalized intent handed to the pipeline by a route. Route zod-validation
 * (pipeline step 1) has already run; the pipeline owns steps 2–16.
 */
export interface IntentInput {
  action: FiberGuardAction;
  appId: string;
  origin: string;
  sessionId: string;
  asset?: string;
  amount?: string;
  invoice?: string;
  description?: string;
  paymentHash?: string;
}

export interface PipelineResult {
  httpStatus: number;
  payload: unknown;
}

/** Actions whose spend counts toward the daily ledger (they carry amount + asset). */
const SPENDING_ACTIONS = new Set<FiberGuardAction>(["payment.pay_invoice", "invoice.create"]);

function toSnapshot(session: StoredSession): PolicySessionSnapshot {
  return {
    sessionId: session.id,
    appId: session.app_id,
    origin: session.origin,
    status: session.status === "revoked" ? "revoked" : "active",
    approvalType: session.approval_type,
    used: session.used,
    expiresAt: session.expires_at,
    permissions: session.permissions,
  };
}

function statusForReason(reason: DecisionReason): number {
  switch (reason) {
    case "INVALID_REQUEST":
      return 400;
    case "APP_NOT_FOUND":
    case "SESSION_NOT_FOUND":
      return 404;
    case "UPSTREAM_FIBER_ERROR":
      return 502;
    default:
      return 403;
  }
}

/** Restricts node_info to non-sensitive summary fields (never the raw UDT config). */
function safeNodeInfo(node: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const field of [
    "version",
    "commit_hash",
    "node_name",
    "pubkey",
    "addresses",
    "chain_hash",
    "channel_count",
    "pending_channel_count",
    "peers_count",
  ]) {
    if (node[field] !== undefined) {
      summary[field] = node[field];
    }
  }
  return summary;
}

function resolveAsset(policy: Policy, asset: string | undefined): AssetConfig {
  const config = asset !== undefined ? policy.assets[asset] : undefined;
  if (config === undefined) {
    throw new UpstreamError(`asset "${asset ?? "(none)"}" is not declared in the policy assets section`);
  }
  return config;
}

interface Forwarded {
  payload: unknown;
  paymentHash?: string;
}

/** Maps an allowed intent to its upstream RPC and shapes the allowed envelope. */
async function forward(ctx: PipelineContext, input: IntentInput): Promise<Forwarded> {
  switch (input.action) {
    case "payment.pay_invoice": {
      if (input.invoice === undefined || input.amount === undefined) {
        throw new UpstreamError("pay_invoice requires an invoice and amount");
      }
      const result = await ctx.fiber.payInvoice({
        invoice: input.invoice,
        amount: input.amount,
        assetConfig: resolveAsset(ctx.policy, input.asset),
      });
      return {
        paymentHash: result.payment_hash,
        payload: {
          status: "forwarded",
          decision: "allowed",
          payment_hash: result.payment_hash,
          fiber_result: result.fiber_result,
        },
      };
    }
    case "invoice.create": {
      if (input.amount === undefined) {
        throw new UpstreamError("invoice.create requires an amount");
      }
      const result = await ctx.fiber.createInvoice({
        amount: input.amount,
        assetConfig: resolveAsset(ctx.policy, input.asset),
        ...(input.description !== undefined ? { description: input.description } : {}),
      });
      return {
        ...(result.payment_hash !== undefined ? { paymentHash: result.payment_hash } : {}),
        payload: {
          status: "forwarded",
          decision: "allowed",
          invoice: result.invoice_address,
          fiber_result: result.fiber_result,
        },
      };
    }
    case "payment.read_own": {
      if (input.paymentHash === undefined) {
        throw new UpstreamError("payment.read_own requires a payment_hash");
      }
      const payment = await ctx.fiber.getPayment(input.paymentHash);
      return {
        payload: {
          status: "allowed",
          payment: {
            payment_hash: input.paymentHash,
            state: typeof payment.status === "string" ? payment.status : "unknown",
          },
        },
      };
    }
    case "node.read": {
      return { payload: { status: "allowed", node: safeNodeInfo(await ctx.fiber.nodeInfo()) } };
    }
    case "channels.read_summary": {
      return { payload: { status: "allowed", summary: await ctx.fiber.channelSummary() } };
    }
    default:
      // Restricted actions are always blocked by evaluateIntent and never reach here.
      throw new UpstreamError(`action "${input.action}" has no upstream mapping`);
  }
}

/**
 * Runs one intent end to end: policy decision, and — for an allowed intent —
 * the upstream forward plus the on-success side effects (ledger, ownership,
 * one-shot consumption). Exactly one audit event is written per call. The
 * spend ledger and ownership index advance ONLY after the upstream succeeds,
 * so a block or an upstream failure leaves persisted state untouched.
 */
export async function runIntent(ctx: PipelineContext, input: IntentInput): Promise<PipelineResult> {
  const now = new Date();
  const session = await ctx.sessionStore.getSession(input.sessionId);

  let paymentOwnedBySession: boolean | undefined;
  if (input.action === "payment.read_own" && input.paymentHash !== undefined) {
    paymentOwnedBySession = await ctx.ownership.isOwnedBy(input.paymentHash, input.sessionId);
  }

  let spentToday: string | undefined;
  if (input.asset !== undefined && input.amount !== undefined) {
    spentToday = await ctx.spendLedger.spentToday(input.appId, input.action, input.asset, now);
  }

  const decision = evaluateIntent({
    policy: ctx.policy,
    appId: input.appId,
    origin: input.origin,
    session: session === null ? null : toSnapshot(session),
    intent: {
      action: input.action,
      ...(input.asset !== undefined ? { asset: input.asset } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(paymentOwnedBySession !== undefined ? { paymentOwnedBySession } : {}),
    },
    now,
    ...(spentToday !== undefined ? { spentToday } : {}),
  });

  if (decision.decision === "blocked") {
    return blockedResult(ctx, input, decision.reason, decision.details);
  }

  let forwarded: Forwarded;
  try {
    forwarded = await forward(ctx, input);
  } catch (error) {
    if (error instanceof InvalidAmountError) {
      return blockedResult(ctx, input, "INVALID_REQUEST", { detail: error.message });
    }
    return blockedResult(ctx, input, "UPSTREAM_FIBER_ERROR", { detail: (error as Error).message });
  }

  if (SPENDING_ACTIONS.has(input.action) && input.asset !== undefined && input.amount !== undefined) {
    await ctx.spendLedger.addSpend(input.appId, input.action, input.asset, input.amount, now);
  }
  if (forwarded.paymentHash !== undefined && SPENDING_ACTIONS.has(input.action)) {
    await ctx.ownership.record(forwarded.paymentHash, input.sessionId, input.appId, now);
  }
  if (session !== null && session.approval_type === "once") {
    await ctx.sessionStore.markSessionUsed(input.sessionId);
  }

  await ctx.audit.record({
    event: "intent_allowed",
    app_id: input.appId,
    origin: input.origin,
    session_id: input.sessionId,
    action: input.action,
    ...(input.asset !== undefined ? { asset: input.asset } : {}),
    ...(input.amount !== undefined ? { requested_amount: input.amount } : {}),
    decision: "allowed",
    reason: "WITHIN_POLICY",
  });
  return { httpStatus: 200, payload: forwarded.payload };
}

async function blockedResult(
  ctx: PipelineContext,
  input: IntentInput,
  reason: DecisionReason,
  details?: Record<string, unknown>,
): Promise<PipelineResult> {
  await ctx.audit.record({
    // Expiry blocks are their own event type (reserved in s5); everything else
    // is a plain intent block. Either way: one event per decision.
    event: reason === "SESSION_EXPIRED" ? "session_expired" : "intent_blocked",
    app_id: input.appId,
    origin: input.origin,
    session_id: input.sessionId,
    action: input.action,
    ...(input.asset !== undefined ? { asset: input.asset } : {}),
    ...(input.amount !== undefined ? { requested_amount: input.amount } : {}),
    decision: "blocked",
    reason,
    ...(details !== undefined ? { details } : {}),
  });
  return { httpStatus: statusForReason(reason), payload: blockedBody(reason, details) };
}
