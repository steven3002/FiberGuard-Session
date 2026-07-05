import { describe, expect, it } from "vitest";
import type { RequestedPermission } from "@fiberguard/shared";
import { DEFAULT_SESSION_TTL_MS, evaluateSessionRequest } from "../src/index.js";
import { fixturePolicy } from "./fixture.js";

const policy = fixturePolicy();

const AGENT = "agent-demo";
const AGENT_ORIGIN = "http://localhost:3001";

const agentPayRequest: RequestedPermission = {
  action: "payment.pay_invoice",
  asset: "RUSD",
  max_amount_per_payment: "1",
  daily_limit: "5",
  expires_in: "10m",
};

describe("evaluateSessionRequest — rejections", () => {
  it("rejects unknown apps", () => {
    const result = evaluateSessionRequest(policy, "ghost-app", AGENT_ORIGIN, [agentPayRequest]);
    expect(result).toMatchObject({ ok: false, reason: "APP_NOT_FOUND" });
  });

  it("rejects wrong origins", () => {
    const result = evaluateSessionRequest(policy, AGENT, "http://evil.example", [agentPayRequest]);
    expect(result).toMatchObject({ ok: false, reason: "ORIGIN_NOT_ALLOWED" });
  });

  it("rejects explicitly denied actions", () => {
    const result = evaluateSessionRequest(policy, AGENT, AGENT_ORIGIN, [
      { action: "channel.open" },
    ]);
    expect(result).toMatchObject({ ok: false, reason: "ACTION_EXPLICITLY_DENIED" });
  });

  it("rejects actions not in the allow list", () => {
    const result = evaluateSessionRequest(policy, AGENT, AGENT_ORIGIN, [
      { action: "invoice.create" },
    ]);
    expect(result).toMatchObject({ ok: false, reason: "ACTION_NOT_ALLOWED" });
  });

  it("rejects assets outside the rule's asset list", () => {
    const result = evaluateSessionRequest(policy, AGENT, AGENT_ORIGIN, [
      { ...agentPayRequest, asset: "CKB" },
    ]);
    expect(result).toMatchObject({
      ok: false,
      reason: "ASSET_NOT_ALLOWED",
      details: { requested_asset: "CKB", allowed_assets: ["RUSD"] },
    });
  });

  it("rejects an asset on an asset-less rule", () => {
    const result = evaluateSessionRequest(policy, "dashboard-demo", "http://localhost:3003", [
      { action: "node.read", asset: "RUSD" },
    ]);
    expect(result).toMatchObject({ ok: false, reason: "ASSET_NOT_ALLOWED" });
  });

  it("rejects per-payment caps above policy", () => {
    const result = evaluateSessionRequest(policy, AGENT, AGENT_ORIGIN, [
      { ...agentPayRequest, max_amount_per_payment: "2" },
    ]);
    expect(result).toMatchObject({
      ok: false,
      reason: "AMOUNT_EXCEEDS_SESSION_LIMIT",
      details: { field: "max_amount_per_payment", requested: "2", policy_max: "1" },
    });
  });

  it("rejects daily limits above policy", () => {
    const result = evaluateSessionRequest(policy, AGENT, AGENT_ORIGIN, [
      { ...agentPayRequest, daily_limit: "50" },
    ]);
    expect(result).toMatchObject({ ok: false, reason: "AMOUNT_EXCEEDS_SESSION_LIMIT" });
  });
});

describe("evaluateSessionRequest — grants", () => {
  it("grants the agent request with approval required and 10m expiry", () => {
    const result = evaluateSessionRequest(policy, AGENT, AGENT_ORIGIN, [agentPayRequest]);
    expect(result).toEqual({
      ok: true,
      requiresApproval: true,
      expiresInMs: 600_000,
      permissions: [
        {
          action: "payment.pay_invoice",
          asset: "RUSD",
          max_amount_per_payment: "1",
          daily_limit: "5",
        },
      ],
    });
  });

  it("inherits policy caps when the request omits limits", () => {
    const result = evaluateSessionRequest(policy, AGENT, AGENT_ORIGIN, [
      { action: "payment.pay_invoice", asset: "RUSD" },
    ]);
    expect(result).toMatchObject({
      ok: true,
      permissions: [{ max_amount_per_payment: "1", daily_limit: "5" }],
    });
  });

  it("keeps tighter self-imposed limits", () => {
    const result = evaluateSessionRequest(policy, AGENT, AGENT_ORIGIN, [
      { ...agentPayRequest, max_amount_per_payment: "0.5" },
    ]);
    expect(result).toMatchObject({
      ok: true,
      permissions: [{ max_amount_per_payment: "0.5" }],
    });
  });

  it("expands asset-less requests to one permission per rule asset", () => {
    const result = evaluateSessionRequest(policy, "merchant-demo", "http://localhost:3002", [
      { action: "invoice.create" },
      { action: "payment.read_own" },
    ]);
    expect(result).toEqual({
      ok: true,
      requiresApproval: false,
      expiresInMs: DEFAULT_SESSION_TTL_MS,
      permissions: [
        { action: "invoice.create", asset: "RUSD", max_amount_per_invoice: "100" },
        { action: "invoice.create", asset: "CKB", max_amount_per_invoice: "100" },
        { action: "payment.read_own" },
      ],
    });
  });

  it("uses the earliest expiry across permissions", () => {
    const result = evaluateSessionRequest(policy, AGENT, AGENT_ORIGIN, [
      { ...agentPayRequest, expires_in: "5m" },
    ]);
    expect(result).toMatchObject({ ok: true, expiresInMs: 300_000 });
  });

  it("deduplicates repeated action/asset requests", () => {
    const result = evaluateSessionRequest(policy, AGENT, AGENT_ORIGIN, [
      agentPayRequest,
      agentPayRequest,
    ]);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.permissions).toHaveLength(1);
    }
  });

  it("defaults the session TTL to 24h when nothing expires sooner", () => {
    const result = evaluateSessionRequest(policy, "dashboard-demo", "http://localhost:3003", [
      { action: "node.read" },
    ]);
    expect(result).toMatchObject({ ok: true, expiresInMs: DEFAULT_SESSION_TTL_MS });
  });
});
