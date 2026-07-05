import { z } from "zod";
import {
  actionSchema,
  appIdSchema,
  assetSchema,
  originSchema,
  positiveAmountSchema,
  sessionIdSchema,
} from "./common.js";

export const payInvoiceBodySchema = z
  .object({
    session_id: sessionIdSchema,
    app_id: appIdSchema,
    origin: originSchema,
    invoice: z.string().min(1),
    asset: assetSchema,
    amount: positiveAmountSchema,
    reason: z.string().max(500).optional(),
  })
  .strict();

export type PayInvoiceBody = z.infer<typeof payInvoiceBodySchema>;

export const createInvoiceBodySchema = z
  .object({
    session_id: sessionIdSchema,
    app_id: appIdSchema,
    origin: originSchema,
    asset: assetSchema,
    amount: positiveAmountSchema,
    description: z.string().max(500).optional(),
  })
  .strict();

export type CreateInvoiceBody = z.infer<typeof createInvoiceBodySchema>;

/**
 * Body for the restricted-action endpoint. It exists so demos can exercise
 * denied actions (channel.open, channel.close, peer.connect, payments.read_all);
 * the gateway never forwards these upstream.
 */
export const restrictedActionBodySchema = z
  .object({
    session_id: sessionIdSchema,
    app_id: appIdSchema,
    origin: originSchema,
    action: actionSchema,
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type RestrictedActionBody = z.infer<typeof restrictedActionBodySchema>;

export const paymentForwardedResponseSchema = z.object({
  status: z.literal("forwarded"),
  decision: z.literal("allowed"),
  payment_hash: z.string(),
  fiber_result: z.record(z.string(), z.unknown()),
});

export const invoiceForwardedResponseSchema = z.object({
  status: z.literal("forwarded"),
  decision: z.literal("allowed"),
  invoice: z.string(),
  fiber_result: z.record(z.string(), z.unknown()),
});

export const paymentReadResponseSchema = z.object({
  status: z.literal("allowed"),
  payment: z.object({
    payment_hash: z.string(),
    state: z.string(),
    amount: z.string().optional(),
    asset: z.string().optional(),
  }),
});

export const channelSummaryResponseSchema = z.object({
  status: z.literal("allowed"),
  summary: z.object({
    total_channels: z.number().int().nonnegative(),
    open_channels: z.number().int().nonnegative(),
    closed_channels: z.number().int().nonnegative(),
  }),
});

export const nodeInfoResponseSchema = z.object({
  status: z.literal("allowed"),
  node: z.record(z.string(), z.unknown()),
});
