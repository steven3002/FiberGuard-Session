import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPolicy } from "@fiberguard/policy";
import { buildApp } from "../src/server/app.js";
import { resolveConfig } from "../src/config.js";

const EXAMPLE_POLICY = fileURLToPath(new URL("../../../examples/fiberguard.yml", import.meta.url));
const policy = loadPolicy(EXAMPLE_POLICY);

const AGENT_REQUEST_BODY = {
  app_id: "agent-demo",
  origin: "http://localhost:3001",
  requested_permissions: [
    {
      action: "payment.pay_invoice",
      asset: "RUSD",
      max_amount_per_payment: "1",
      daily_limit: "5",
      expires_in: "10m",
    },
  ],
};

describe("session lifecycle", () => {
  let app: FastifyInstance;
  let dataDir: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "fiberguard-sessions-"));
    app = await buildApp({
      config: resolveConfig({
        upstream: "http://127.0.0.1:8227",
        port: "8787",
        policy: EXAMPLE_POLICY,
        data: dataDir,
      }),
      policy,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  async function requestAgentSession() {
    const response = await app.inject({
      method: "POST",
      url: "/session/request",
      payload: AGENT_REQUEST_BODY,
    });
    return response.json() as {
      status: string;
      session_request_id: string;
      approval_url: string;
    };
  }

  async function approvedAgentSession(approvalType: "session" | "once" = "session") {
    const pending = await requestAgentSession();
    const response = await app.inject({
      method: "POST",
      url: "/session/approve",
      payload: { session_request_id: pending.session_request_id, approval_type: approvalType },
    });
    return response.json() as { status: string; session_id: string; expires_at: string };
  }

  it("returns pending_approval with an approval URL for approval-gated permissions", async () => {
    const body = await requestAgentSession();
    expect(body.status).toBe("pending_approval");
    expect(body.session_request_id).toMatch(/^sr_/);
    expect(body.approval_url).toBe(`http://localhost:8787/approve/${body.session_request_id}`);
  });

  it("approves a pending request and serves the active session", async () => {
    const before = Date.now();
    const approved = await approvedAgentSession();
    expect(approved.status).toBe("approved");
    expect(approved.session_id).toMatch(/^sess_/);

    const expiresIn = Date.parse(approved.expires_at) - before;
    expect(expiresIn).toBeGreaterThan(9 * 60 * 1000);
    expect(expiresIn).toBeLessThanOrEqual(11 * 60 * 1000);

    const current = await app.inject({
      method: "GET",
      url: `/session/current?session_id=${approved.session_id}`,
    });
    expect(current.statusCode).toBe(200);
    expect(current.json()).toMatchObject({
      session_id: approved.session_id,
      app_id: "agent-demo",
      status: "active",
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

  it("rejects double approval of the same request", async () => {
    const pending = await requestAgentSession();
    const approve = () =>
      app.inject({
        method: "POST",
        url: "/session/approve",
        payload: { session_request_id: pending.session_request_id, approval_type: "session" },
      });
    expect((await approve()).statusCode).toBe(200);
    const second = await approve();
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ status: "blocked", reason: "INVALID_REQUEST" });
  });

  it("denies a pending request and blocks later approval", async () => {
    const pending = await requestAgentSession();
    const denied = await app.inject({
      method: "POST",
      url: "/session/deny",
      payload: { session_request_id: pending.session_request_id, reason: "User denied request" },
    });
    expect(denied.json()).toEqual({ status: "denied" });

    const approve = await app.inject({
      method: "POST",
      url: "/session/approve",
      payload: { session_request_id: pending.session_request_id, approval_type: "session" },
    });
    expect(approve.statusCode).toBe(409);
  });

  it("auto-approves sessions that need no approval (merchant)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/session/request",
      payload: {
        app_id: "merchant-demo",
        origin: "http://localhost:3002",
        requested_permissions: [{ action: "invoice.create" }, { action: "payment.read_own" }],
      },
    });
    const body = response.json();
    expect(body.status).toBe("approved");

    const current = await app.inject({
      method: "GET",
      url: `/session/current?session_id=${body.session_id}`,
    });
    expect(current.json().permissions).toEqual([
      { action: "invoice.create", asset: "RUSD", max_amount_per_invoice: "100" },
      { action: "invoice.create", asset: "CKB", max_amount_per_invoice: "100" },
      { action: "payment.read_own" },
    ]);
  });

  it("blocks unknown apps and wrong origins with reason codes", async () => {
    const unknownApp = await app.inject({
      method: "POST",
      url: "/session/request",
      payload: { ...AGENT_REQUEST_BODY, app_id: "ghost-app" },
    });
    expect(unknownApp.statusCode).toBe(403);
    expect(unknownApp.json()).toMatchObject({ status: "blocked", reason: "APP_NOT_FOUND" });

    const wrongOrigin = await app.inject({
      method: "POST",
      url: "/session/request",
      payload: { ...AGENT_REQUEST_BODY, origin: "http://evil.example" },
    });
    expect(wrongOrigin.statusCode).toBe(403);
    expect(wrongOrigin.json()).toMatchObject({ status: "blocked", reason: "ORIGIN_NOT_ALLOWED" });
  });

  it("rejects malformed bodies with INVALID_REQUEST", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/session/request",
      payload: { app_id: "agent-demo" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ status: "blocked", reason: "INVALID_REQUEST" });
  });

  it("revokes sessions idempotently", async () => {
    const approved = await approvedAgentSession();
    const revoke = () =>
      app.inject({
        method: "POST",
        url: "/session/revoke",
        payload: { session_id: approved.session_id },
      });

    expect((await revoke()).json()).toEqual({
      status: "revoked",
      session_id: approved.session_id,
    });
    expect((await revoke()).statusCode).toBe(200);

    const current = await app.inject({
      method: "GET",
      url: `/session/current?session_id=${approved.session_id}`,
    });
    expect(current.json().status).toBe("revoked");
  });

  it("returns 404 for unknown sessions", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/session/current?session_id=sess_doesnotexist",
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ status: "blocked", reason: "SESSION_NOT_FOUND" });
  });

  it("reports expired sessions from lazy expiry checks", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/session/request",
      payload: {
        ...AGENT_REQUEST_BODY,
        requested_permissions: [
          { ...AGENT_REQUEST_BODY.requested_permissions[0], expires_in: "1ms" },
        ],
      },
    });
    const pending = response.json();
    const approve = await app.inject({
      method: "POST",
      url: "/session/approve",
      payload: { session_request_id: pending.session_request_id, approval_type: "session" },
    });
    const sessionId = approve.json().session_id;

    await new Promise((resolve) => setTimeout(resolve, 5));
    const current = await app.inject({
      method: "GET",
      url: `/session/current?session_id=${sessionId}`,
    });
    expect(current.json().status).toBe("expired");
  });

  it("lists pending requests with approval-screen details", async () => {
    const pending = await requestAgentSession();
    const list = await app.inject({ method: "GET", url: "/session/pending" });
    const { requests } = list.json();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      session_request_id: pending.session_request_id,
      app_id: "agent-demo",
      app_name: "Agent Demo",
      origin: "http://localhost:3001",
      status: "pending",
      expires_in_ms: 600_000,
      denied_actions: ["channel.open", "channel.close", "peer.connect", "payments.read_all"],
    });

    const detail = await app.inject({
      method: "GET",
      url: `/session/request/${pending.session_request_id}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().permissions).toEqual([
      {
        action: "payment.pay_invoice",
        asset: "RUSD",
        max_amount_per_payment: "1",
        daily_limit: "5",
      },
    ]);

    const missing = await app.inject({ method: "GET", url: "/session/request/sr_missing00" });
    expect(missing.statusCode).toBe(404);
  });

  it("persists sessions across gateway restarts", async () => {
    const approved = await approvedAgentSession();
    await app.close();

    app = await buildApp({
      config: resolveConfig({
        upstream: "http://127.0.0.1:8227",
        port: "8787",
        policy: EXAMPLE_POLICY,
        data: dataDir,
      }),
      policy,
    });
    const current = await app.inject({
      method: "GET",
      url: `/session/current?session_id=${approved.session_id}`,
    });
    expect(current.json()).toMatchObject({ session_id: approved.session_id, status: "active" });
  });

  it("lists active sessions and drops them once revoked", async () => {
    const first = await approvedAgentSession();
    const second = await approvedAgentSession();

    const listed = await app.inject({ method: "GET", url: "/session/active" });
    const { sessions } = listed.json();
    expect(sessions.map((s: { session_id: string }) => s.session_id).sort()).toEqual(
      [first.session_id, second.session_id].sort(),
    );
    expect(sessions[0]).toMatchObject({
      app_id: "agent-demo",
      app_name: "Agent Demo",
      origin: "http://localhost:3001",
      status: "active",
      approval_type: "session",
    });

    await app.inject({
      method: "POST",
      url: "/session/revoke",
      payload: { session_id: first.session_id },
    });
    const afterRevoke = await app.inject({ method: "GET", url: "/session/active" });
    expect(
      afterRevoke.json().sessions.map((s: { session_id: string }) => s.session_id),
    ).toEqual([second.session_id]);
  });

  it("writes audit events for every lifecycle transition", async () => {
    const pending = await requestAgentSession();
    await app.inject({
      method: "POST",
      url: "/session/approve",
      payload: { session_request_id: pending.session_request_id, approval_type: "session" },
    });
    const approved = await approvedAgentSession();
    await app.inject({
      method: "POST",
      url: "/session/revoke",
      payload: { session_id: approved.session_id },
    });
    await app.inject({
      method: "POST",
      url: "/session/request",
      payload: { ...AGENT_REQUEST_BODY, app_id: "ghost-app" },
    });

    const lines = readFileSync(join(dataDir, "audit.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const events = lines.map((entry) => `${entry.event}:${entry.decision}:${entry.reason}`);
    expect(events).toContain("session_requested:allowed:APPROVAL_REQUIRED");
    expect(events).toContain("session_approved:allowed:WITHIN_POLICY");
    expect(events).toContain("session_revoked:allowed:WITHIN_POLICY");
    expect(events).toContain("session_requested:blocked:APP_NOT_FOUND");
    for (const entry of lines) {
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});
