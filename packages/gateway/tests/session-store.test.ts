import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  effectiveStatus,
  SessionStore,
  SessionStoreError,
} from "../src/core/sessions/store.js";

const NOW = new Date("2026-07-05T12:00:00Z");

function newStore(): SessionStore {
  return new SessionStore(mkdtempSync(join(tmpdir(), "fiberguard-store-")));
}

function sessionInput(overrides: Record<string, unknown> = {}) {
  return {
    appId: "agent-demo",
    origin: "http://localhost:3001",
    permissions: [{ action: "payment.pay_invoice" as const, asset: "RUSD" }],
    expiresInMs: 600_000,
    approvalType: "session" as const,
    now: NOW,
    ...overrides,
  };
}

describe("SessionStore", () => {
  it("consumes one-shot sessions via markSessionUsed", async () => {
    const store = newStore();
    const session = await store.createSession(sessionInput({ approvalType: "once" }));
    expect(effectiveStatus(session, NOW)).toBe("active");

    const used = await store.markSessionUsed(session.id);
    expect(used.used).toBe(true);
    expect(effectiveStatus(used, NOW)).toBe("consumed");
  });

  it("does not mark ordinary sessions as consumed when used", async () => {
    const store = newStore();
    const session = await store.createSession(sessionInput());
    const used = await store.markSessionUsed(session.id);
    expect(effectiveStatus(used, NOW)).toBe("active");
  });

  it("computes expiry from the stored instant", async () => {
    const store = newStore();
    const session = await store.createSession(sessionInput());
    expect(session.expires_at).toBe("2026-07-05T12:10:00.000Z");
    expect(effectiveStatus(session, new Date("2026-07-05T12:09:59Z"))).toBe("active");
    expect(effectiveStatus(session, new Date("2026-07-05T12:10:00Z"))).toBe("expired");
  });

  it("reports revoked ahead of expired for display", async () => {
    const store = newStore();
    const session = await store.createSession(sessionInput());
    const { session: revoked } = await store.revokeSession(session.id, NOW);
    expect(effectiveStatus(revoked, new Date("2026-07-06T00:00:00Z"))).toBe("revoked");
  });

  it("throws typed errors for unknown ids", async () => {
    const store = newStore();
    await expect(store.revokeSession("sess_missing1", NOW)).rejects.toThrow(SessionStoreError);
    await expect(store.approveRequest("sr_missing01", "session", NOW)).rejects.toMatchObject({
      code: "REQUEST_NOT_FOUND",
    });
    await expect(store.denyRequest("sr_missing01", NOW)).rejects.toMatchObject({
      code: "REQUEST_NOT_FOUND",
    });
  });

  it("copies granted permissions from request to session on approval", async () => {
    const store = newStore();
    const record = await store.createRequest({
      appId: "agent-demo",
      origin: "http://localhost:3001",
      requestedPermissions: [{ action: "payment.pay_invoice", asset: "RUSD" }],
      grantedPermissions: [
        { action: "payment.pay_invoice", asset: "RUSD", max_amount_per_payment: "1" },
      ],
      expiresInMs: 600_000,
      now: NOW,
    });
    const session = await store.approveRequest(record.id, "once", NOW);
    expect(session.approval_type).toBe("once");
    expect(session.session_request_id).toBe(record.id);
    expect(session.permissions).toEqual([
      { action: "payment.pay_invoice", asset: "RUSD", max_amount_per_payment: "1" },
    ]);

    const updated = await store.getRequest(record.id);
    expect(updated).toMatchObject({ status: "approved", session_id: session.id });
  });
});
