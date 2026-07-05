import { z } from "zod";
import {
  actionSchema,
  amountSchema,
  appIdSchema,
  decisionReasonSchema,
  decisionSchema,
} from "./common.js";

export const auditEventTypeSchema = z.enum([
  "session_requested",
  "session_approved",
  "session_denied",
  "session_revoked",
  "session_expired",
  "intent_allowed",
  "intent_blocked",
]);

export type AuditEventType = z.infer<typeof auditEventTypeSchema>;

export const auditEventSchema = z.object({
  event: auditEventTypeSchema,
  app_id: appIdSchema.optional(),
  origin: z.string().optional(),
  session_id: z.string().optional(),
  action: actionSchema.optional(),
  asset: z.string().optional(),
  requested_amount: amountSchema.optional(),
  decision: decisionSchema,
  reason: decisionReasonSchema,
  details: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string().datetime(),
});

export type AuditEvent = z.infer<typeof auditEventSchema>;

export const auditResponseSchema = z.object({
  events: z.array(auditEventSchema),
});

export type AuditResponse = z.infer<typeof auditResponseSchema>;
