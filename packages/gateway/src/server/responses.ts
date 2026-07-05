import type { DecisionReason } from "@fiberguard/shared";

export interface BlockedBody {
  status: "blocked";
  decision: "blocked";
  reason: DecisionReason;
  details?: Record<string, unknown>;
}

/**
 * Standard envelope for any request the gateway refuses, per product doc §11.6.
 * Shared across every route so blocked responses and audit entries carry the
 * same reason codes.
 */
export function blockedBody(
  reason: DecisionReason,
  details?: Record<string, unknown>,
): BlockedBody {
  return {
    status: "blocked",
    decision: "blocked",
    reason,
    ...(details !== undefined ? { details } : {}),
  };
}
