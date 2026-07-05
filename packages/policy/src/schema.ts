import { z } from "zod";
import {
  actionSchema,
  appIdSchema,
  assetSchema,
  durationSchema,
  originSchema,
  positiveAmountSchema,
} from "@fiberguard/shared";

/** CKB script reference identifying a UDT asset on chain. */
export const ckbScriptSchema = z
  .object({
    code_hash: z.string().regex(/^0x[0-9a-f]{64}$/i, {
      message: "must be a 0x-prefixed 32-byte hash",
    }),
    hash_type: z.enum(["type", "data", "data1", "data2"]),
    args: z.string().regex(/^0x[0-9a-f]*$/i, { message: "must be 0x-prefixed hex" }),
  })
  .strict();

export type CkbScript = z.infer<typeof ckbScriptSchema>;

/**
 * Asset declaration used to translate decimal amounts into base units at the
 * Fiber RPC boundary. An asset is either the native coin (`native: true`) or a
 * UDT identified by its type script — exactly one of the two.
 */
export const assetConfigSchema = z
  .object({
    decimals: z.number().int().min(0).max(18),
    native: z.literal(true).optional(),
    udt_type_script: ckbScriptSchema.optional(),
  })
  .strict()
  .refine((config) => (config.native === true) !== (config.udt_type_script !== undefined), {
    message: "asset must declare either native: true or a udt_type_script, not both or neither",
  });

export type AssetConfig = z.infer<typeof assetConfigSchema>;

export const allowRuleSchema = z
  .object({
    action: actionSchema,
    assets: z.array(assetSchema).min(1).optional(),
    max_amount_per_payment: positiveAmountSchema.optional(),
    max_amount_per_invoice: positiveAmountSchema.optional(),
    daily_limit: positiveAmountSchema.optional(),
    require_approval: z.boolean().optional(),
    expires_in: durationSchema.optional(),
  })
  .strict();

export type AllowRule = z.infer<typeof allowRuleSchema>;

export const denyRuleSchema = z
  .object({
    action: actionSchema,
  })
  .strict();

export type DenyRule = z.infer<typeof denyRuleSchema>;

export const appPolicySchema = z
  .object({
    name: z.string().min(1).max(100),
    origins: z.array(originSchema).min(1),
    allow: z.array(allowRuleSchema).default([]),
    deny: z.array(denyRuleSchema).default([]),
  })
  .strict();

export type AppPolicy = z.infer<typeof appPolicySchema>;

/**
 * Root schema of fiberguard.yml. The assets section is optional: it is only
 * required once intents are forwarded to a real upstream, where base-unit
 * conversion needs script and decimal information.
 */
export const policyFileSchema = z
  .object({
    assets: z.record(assetSchema, assetConfigSchema).default({}),
    apps: z.record(appIdSchema, appPolicySchema),
  })
  .strict();

export type Policy = z.infer<typeof policyFileSchema>;
