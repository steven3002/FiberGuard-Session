import { z } from "zod";
import { FIBERGUARD_ACTIONS } from "../actions.js";
import { DECISION_REASONS } from "../reasons.js";
import { isValidAmount, isZeroAmount } from "../amount.js";
import { isValidDuration } from "../duration.js";

export const actionSchema = z.enum(FIBERGUARD_ACTIONS);

export const decisionReasonSchema = z.enum(DECISION_REASONS);

export const decisionSchema = z.enum(["allowed", "blocked"]);

/** Non-negative decimal string, e.g. "0.5", "1", "100". Floats and signs rejected. */
export const amountSchema = z.string().refine(isValidAmount, {
  message: "must be a plain non-negative decimal string",
  // Later refinements assume a well-formed decimal string; stop here if not.
  abort: true,
});

/** Amount that must be strictly greater than zero. */
export const positiveAmountSchema = amountSchema.refine(
  (value) => !isZeroAmount(value),
  { message: "must be greater than zero" },
);

/** Duration string such as "10m", "30s", "2h", "1d". */
export const durationSchema = z
  .string()
  .refine(isValidDuration, { message: 'must be a duration such as "10m", "2h", or "1d"' });

export const appIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/i, {
    message: "must contain only letters, digits, hyphens, and underscores",
  });

/** Web origin (scheme + host + optional port), no path or trailing slash. */
export const originSchema = z.string().refine(
  (value) => {
    try {
      return new URL(value).origin === value;
    } catch {
      return false;
    }
  },
  { message: 'must be a web origin such as "http://localhost:3001"' },
);

export const sessionIdSchema = z.string().regex(/^sess_[A-Za-z0-9_-]{8,}$/, {
  message: "must be a session id",
});

export const sessionRequestIdSchema = z.string().regex(/^sr_[A-Za-z0-9_-]{8,}$/, {
  message: "must be a session request id",
});

/** Asset symbol as used in policy files, e.g. "RUSD", "CKB". */
export const assetSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[A-Z0-9]+$/, { message: "must be an upper-case asset symbol" });

/** Standard envelope for every blocked decision returned by the gateway. */
export const blockedResponseSchema = z.object({
  status: z.literal("blocked"),
  decision: z.literal("blocked"),
  reason: decisionReasonSchema,
  details: z.record(z.string(), z.unknown()).optional(),
});

export type BlockedResponse = z.infer<typeof blockedResponseSchema>;
