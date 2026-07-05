import { z } from "zod";
import {
  actionSchema,
  amountSchema,
  appIdSchema,
  assetSchema,
  durationSchema,
  originSchema,
  positiveAmountSchema,
  sessionIdSchema,
  sessionRequestIdSchema,
} from "./common.js";

/**
 * A permission an app asks for when opening a session. Only `action` is
 * mandatory; limits apply per action type (payment vs invoice) and read-only
 * actions carry no limits at all.
 */
export const requestedPermissionSchema = z
  .object({
    action: actionSchema,
    asset: assetSchema.optional(),
    max_amount_per_payment: positiveAmountSchema.optional(),
    max_amount_per_invoice: positiveAmountSchema.optional(),
    daily_limit: positiveAmountSchema.optional(),
    expires_in: durationSchema.optional(),
  })
  .strict();

export type RequestedPermission = z.infer<typeof requestedPermissionSchema>;

export const sessionRequestBodySchema = z
  .object({
    app_id: appIdSchema,
    origin: originSchema,
    requested_permissions: z.array(requestedPermissionSchema).min(1),
  })
  .strict();

export type SessionRequestBody = z.infer<typeof sessionRequestBodySchema>;

/**
 * "session": grant until expiry. "once": one-shot session consumed by the
 * first allowed intent.
 */
export const approvalTypeSchema = z.enum(["session", "once"]);

export type ApprovalType = z.infer<typeof approvalTypeSchema>;

export const approveSessionBodySchema = z
  .object({
    session_request_id: sessionRequestIdSchema,
    approval_type: approvalTypeSchema,
  })
  .strict();

export const denySessionBodySchema = z
  .object({
    session_request_id: sessionRequestIdSchema,
    reason: z.string().max(500).optional(),
  })
  .strict();

export const revokeSessionBodySchema = z
  .object({
    session_id: sessionIdSchema,
  })
  .strict();

/** Permission actually granted on a session, already clamped to policy caps. */
export const grantedPermissionSchema = z
  .object({
    action: actionSchema,
    asset: assetSchema.optional(),
    max_amount_per_payment: amountSchema.optional(),
    max_amount_per_invoice: amountSchema.optional(),
    daily_limit: amountSchema.optional(),
  })
  .strict();

export type GrantedPermission = z.infer<typeof grantedPermissionSchema>;

export const sessionStatusSchema = z.enum(["active", "revoked", "expired", "consumed"]);

export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const sessionPendingResponseSchema = z.object({
  status: z.literal("pending_approval"),
  session_request_id: sessionRequestIdSchema,
  approval_url: z.string(),
});

export const sessionApprovedResponseSchema = z.object({
  status: z.literal("approved"),
  session_id: sessionIdSchema,
  expires_at: z.string().datetime(),
});

export const sessionDeniedResponseSchema = z.object({
  status: z.literal("denied"),
});

export const sessionRevokedResponseSchema = z.object({
  status: z.literal("revoked"),
  session_id: sessionIdSchema,
});

export const currentSessionResponseSchema = z.object({
  session_id: sessionIdSchema,
  app_id: appIdSchema,
  status: sessionStatusSchema,
  expires_at: z.string().datetime(),
  permissions: z.array(grantedPermissionSchema),
});

export type CurrentSessionResponse = z.infer<typeof currentSessionResponseSchema>;
