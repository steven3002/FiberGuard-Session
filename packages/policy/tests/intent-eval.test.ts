import { describe, expect, it } from "vitest";
import { evaluateIntent, type PolicySessionSnapshot } from "../src/index.js";
import { fixturePolicy } from "./fixture.js";

const policy = fixturePolicy();
const NOW = new Date("2026-07-05T12:00:00Z");
const FUTURE = "2026-07-05T12:10:00.000Z";
const PAST = "2026-07-05T11:00:00.000Z";

function agentSession(overrides: Partial<PolicySessionSnapshot> = {}): PolicySessionSnapshot {
  return {
    sessionId: "sess_agent00001",
    appId: "agent-demo",
    origin: "http://localhost:3001",
    status: "active",
    approvalType: "session",
    used: false,
    expiresAt: FUTURE,
    permissions: [
      {
        action: "payment.pay_invoice",
        asset: "RUSD",
        max_amount_per_payment: "1",
        daily_limit: "5",
      },
      { action: "payment.read_own" },
    ],
    ...overrides,
  };
}

function merchantSession(overrides: Partial<PolicySessionSnapshot> = {}): PolicySessionSnapshot {
  return {
    sessionId: "sess_merchant01",
    appId: "merchant-demo",
    origin: "http://localhost:3002",
    status: "active",
    approvalType: "session",
    used: false,
    expiresAt: FUTURE,
    permissions: [
      { action: "invoice.create", asset: "RUSD", max_amount_per_invoice: "100" },
      { action: "invoice.create", asset: "CKB", max_amount_per_invoice: "100" },
      { action: "payment.read_own" },
    ],
    ...overrides,
  };
}

const payHalf = { action: "payment.pay_invoice", asset: "RUSD", amount: "0.5" } as const;

describe("evaluateIntent — app and origin checks", () => {
  it("blocks unknown apps", () => {
    const decision = evaluateIntent({
      policy,
      appId: "ghost-app",
      origin: "http://localhost:3001",
      session: agentSession(),
      intent: payHalf,
      now: NOW,
    });
    expect(decision).toMatchObject({ decision: "blocked", reason: "APP_NOT_FOUND" });
  });

  it("blocks disallowed origins", () => {
    const decision = evaluateIntent({
      policy,
      appId: "agent-demo",
      origin: "http://evil.example",
      session: agentSession(),
      intent: payHalf,
      now: NOW,
    });
    expect(decision).toMatchObject({ decision: "blocked", reason: "ORIGIN_NOT_ALLOWED" });
  });
});

describe("evaluateIntent — session state checks", () => {
  const base = { policy, appId: "agent-demo", origin: "http://localhost:3001", intent: payHalf, now: NOW };

  it("blocks missing sessions", () => {
    expect(evaluateIntent({ ...base, session: null })).toMatchObject({
      reason: "SESSION_NOT_FOUND",
    });
  });

  it("blocks sessions belonging to another app", () => {
    expect(evaluateIntent({ ...base, session: merchantSession() })).toMatchObject({
      reason: "SESSION_NOT_FOUND",
    });
  });

  it("blocks pending sessions", () => {
    expect(
      evaluateIntent({ ...base, session: agentSession({ status: "pending_approval" }) }),
    ).toMatchObject({ reason: "SESSION_PENDING_APPROVAL" });
  });

  it("blocks expired sessions", () => {
    expect(evaluateIntent({ ...base, session: agentSession({ expiresAt: PAST }) })).toMatchObject({
      reason: "SESSION_EXPIRED",
    });
  });

  it("reports expiry before revocation when both apply", () => {
    expect(
      evaluateIntent({
        ...base,
        session: agentSession({ status: "revoked", expiresAt: PAST }),
      }),
    ).toMatchObject({ reason: "SESSION_EXPIRED" });
  });

  it("blocks revoked sessions", () => {
    expect(
      evaluateIntent({ ...base, session: agentSession({ status: "revoked" }) }),
    ).toMatchObject({ reason: "SESSION_REVOKED" });
  });

  it("blocks consumed one-shot sessions", () => {
    expect(
      evaluateIntent({
        ...base,
        session: agentSession({ approvalType: "once", used: true }),
      }),
    ).toMatchObject({ reason: "SESSION_EXPIRED", details: { consumed: true } });
  });

  it("allows unconsumed one-shot sessions", () => {
    expect(
      evaluateIntent({
        ...base,
        session: agentSession({ approvalType: "once", used: false }),
      }),
    ).toMatchObject({ decision: "allowed" });
  });
});

describe("evaluateIntent — action and asset checks", () => {
  it("blocks explicitly denied actions (deny beats everything)", () => {
    const decision = evaluateIntent({
      policy,
      appId: "agent-demo",
      origin: "http://localhost:3001",
      session: agentSession(),
      intent: { action: "channel.open" },
      now: NOW,
    });
    expect(decision).toMatchObject({ reason: "ACTION_EXPLICITLY_DENIED" });
  });

  it("blocks actions that were never granted", () => {
    const decision = evaluateIntent({
      policy,
      appId: "merchant-demo",
      origin: "http://localhost:3002",
      session: merchantSession(),
      intent: payHalf,
      now: NOW,
    });
    expect(decision).toMatchObject({ reason: "ACTION_NOT_ALLOWED" });
  });

  it("blocks assets outside the granted permission", () => {
    const decision = evaluateIntent({
      policy,
      appId: "agent-demo",
      origin: "http://localhost:3001",
      session: agentSession(),
      intent: { action: "payment.pay_invoice", asset: "CKB", amount: "0.5" },
      now: NOW,
    });
    expect(decision).toMatchObject({
      reason: "ASSET_NOT_ALLOWED",
      details: { requested_asset: "CKB", allowed_assets: ["RUSD"] },
    });
  });
});

describe("evaluateIntent — amount checks", () => {
  const base = { policy, appId: "agent-demo", origin: "http://localhost:3001", now: NOW };

  it("blocks payments above the per-payment cap with spec-shaped details", () => {
    const decision = evaluateIntent({
      ...base,
      session: agentSession(),
      intent: { action: "payment.pay_invoice", asset: "RUSD", amount: "100" },
    });
    expect(decision).toEqual({
      decision: "blocked",
      reason: "AMOUNT_EXCEEDS_SESSION_LIMIT",
      details: { requested_amount: "100", max_amount_per_payment: "1", asset: "RUSD" },
    });
  });

  it("requires an amount when a cap applies", () => {
    const decision = evaluateIntent({
      ...base,
      session: agentSession(),
      intent: { action: "payment.pay_invoice", asset: "RUSD" },
    });
    expect(decision).toMatchObject({ reason: "INVALID_REQUEST" });
  });

  it("blocks payments that would cross the daily limit", () => {
    const decision = evaluateIntent({
      ...base,
      session: agentSession(),
      intent: payHalf,
      spentToday: "4.8",
    });
    expect(decision).toMatchObject({
      reason: "AMOUNT_EXCEEDS_DAILY_LIMIT",
      details: { requested_amount: "0.5", spent_today: "4.8", daily_limit: "5" },
    });
  });

  it("allows spending exactly up to the daily limit", () => {
    const decision = evaluateIntent({
      ...base,
      session: agentSession(),
      intent: payHalf,
      spentToday: "4.5",
    });
    expect(decision).toMatchObject({ decision: "allowed", reason: "WITHIN_POLICY" });
  });

  it("enforces the invoice cap for invoice.create", () => {
    const blocked = evaluateIntent({
      policy,
      appId: "merchant-demo",
      origin: "http://localhost:3002",
      session: merchantSession(),
      intent: { action: "invoice.create", asset: "RUSD", amount: "150" },
      now: NOW,
    });
    expect(blocked).toMatchObject({
      reason: "AMOUNT_EXCEEDS_SESSION_LIMIT",
      details: { max_amount_per_invoice: "100" },
    });

    const allowed = evaluateIntent({
      policy,
      appId: "merchant-demo",
      origin: "http://localhost:3002",
      session: merchantSession(),
      intent: { action: "invoice.create", asset: "RUSD", amount: "10" },
      now: NOW,
    });
    expect(allowed).toMatchObject({ decision: "allowed" });
  });
});

describe("evaluateIntent — ownership and happy path", () => {
  it("blocks reading payments the session does not own", () => {
    const decision = evaluateIntent({
      policy,
      appId: "merchant-demo",
      origin: "http://localhost:3002",
      session: merchantSession(),
      intent: { action: "payment.read_own", paymentOwnedBySession: false },
      now: NOW,
    });
    expect(decision).toMatchObject({ reason: "PAYMENT_NOT_OWNED_BY_SESSION" });
  });

  it("allows a compliant payment and returns the matched permission", () => {
    const decision = evaluateIntent({
      policy,
      appId: "agent-demo",
      origin: "http://localhost:3001",
      session: agentSession(),
      intent: payHalf,
      now: NOW,
    });
    expect(decision).toEqual({
      decision: "allowed",
      reason: "WITHIN_POLICY",
      permission: {
        action: "payment.pay_invoice",
        asset: "RUSD",
        max_amount_per_payment: "1",
        daily_limit: "5",
      },
    });
  });

  it("allows dashboard reads without amounts", () => {
    const session: PolicySessionSnapshot = {
      sessionId: "sess_dash000001",
      appId: "dashboard-demo",
      origin: "http://localhost:3003",
      status: "active",
      approvalType: "session",
      used: false,
      expiresAt: FUTURE,
      permissions: [
        { action: "node.read" },
        { action: "channels.read_summary" },
        { action: "payment.read_own" },
      ],
    };
    const decision = evaluateIntent({
      policy,
      appId: "dashboard-demo",
      origin: "http://localhost:3003",
      session,
      intent: { action: "channels.read_summary" },
      now: NOW,
    });
    expect(decision).toMatchObject({ decision: "allowed" });

    const blocked = evaluateIntent({
      policy,
      appId: "dashboard-demo",
      origin: "http://localhost:3003",
      session,
      intent: { action: "channel.close" },
      now: NOW,
    });
    expect(blocked).toMatchObject({ reason: "ACTION_EXPLICITLY_DENIED" });
  });
});
