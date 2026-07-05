import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditEventSchema, type AuditEvent } from "@fiberguard/shared";
import { loadPolicy } from "@fiberguard/policy";
import { buildApp } from "../src/server/app.js";
import { resolveConfig } from "../src/config.js";
import { AuditReader } from "../src/core/audit/reader.js";
import { AuditWriter } from "../src/core/audit/writer.js";

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

const MERCHANT_REQUEST_BODY = {
  app_id: "merchant-demo",
  origin: "http://localhost:3002",
  requested_permissions: [{ action: "invoice.create" }, { action: "payment.read_own" }],
};

describe("AuditReader", () => {
  async function seed(events: Array<Omit<AuditEvent, "timestamp">>): Promise<string> {
    const path = join(mkdtempSync(join(tmpdir(), "fiberguard-audit-")), "audit.jsonl");
    const writer = new AuditWriter(path);
    for (const event of events) {
      await writer.record(event);
    }
    return path;
  }

  const triple = (event: AuditEvent) => `${event.event}:${event.app_id ?? "-"}`;

  it("returns an empty list when the log does not exist", async () => {
    const reader = new AuditReader(join(tmpdir(), "fiberguard-missing", "audit.jsonl"));
    expect(await reader.query()).toEqual([]);
  });

  it("returns events newest-first", async () => {
    const path = await seed([
      { event: "session_requested", app_id: "agent-demo", decision: "allowed", reason: "APPROVAL_REQUIRED" },
      { event: "session_approved", app_id: "agent-demo", decision: "allowed", reason: "WITHIN_POLICY" },
      { event: "session_revoked", app_id: "agent-demo", decision: "allowed", reason: "WITHIN_POLICY" },
    ]);
    const events = await new AuditReader(path).query();
    expect(events.map((e) => e.event)).toEqual([
      "session_revoked",
      "session_approved",
      "session_requested",
    ]);
  });

  it("filters by app id", async () => {
    const path = await seed([
      { event: "session_approved", app_id: "agent-demo", decision: "allowed", reason: "WITHIN_POLICY" },
      { event: "session_approved", app_id: "merchant-demo", decision: "allowed", reason: "WITHIN_POLICY" },
      { event: "session_revoked", app_id: "agent-demo", decision: "allowed", reason: "WITHIN_POLICY" },
    ]);
    const events = await new AuditReader(path).query({ appId: "agent-demo" });
    expect(events.map(triple)).toEqual(["session_revoked:agent-demo", "session_approved:agent-demo"]);
  });

  it("returns no events for an unknown app id", async () => {
    const path = await seed([
      { event: "session_approved", app_id: "agent-demo", decision: "allowed", reason: "WITHIN_POLICY" },
    ]);
    expect(await new AuditReader(path).query({ appId: "nobody" })).toEqual([]);
  });

  it("caps results with limit, keeping the most recent", async () => {
    const path = await seed([
      { event: "session_requested", app_id: "a", decision: "allowed", reason: "APPROVAL_REQUIRED" },
      { event: "session_approved", app_id: "b", decision: "allowed", reason: "WITHIN_POLICY" },
      { event: "session_revoked", app_id: "c", decision: "allowed", reason: "WITHIN_POLICY" },
    ]);
    const events = await new AuditReader(path).query({ limit: 2 });
    expect(events.map((e) => e.app_id)).toEqual(["c", "b"]);
  });

  it("applies the filter before the limit", async () => {
    const path = await seed([
      { event: "session_approved", app_id: "agent-demo", decision: "allowed", reason: "WITHIN_POLICY" },
      { event: "session_approved", app_id: "merchant-demo", decision: "allowed", reason: "WITHIN_POLICY" },
      { event: "session_revoked", app_id: "agent-demo", decision: "allowed", reason: "WITHIN_POLICY" },
      { event: "session_requested", app_id: "agent-demo", decision: "allowed", reason: "APPROVAL_REQUIRED" },
    ]);
    const events = await new AuditReader(path).query({ appId: "agent-demo", limit: 1 });
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe("session_requested");
  });
});

describe("GET /audit", () => {
  let app: FastifyInstance;
  let dataDir: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "fiberguard-audit-route-"));
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

  it("serves recorded events newest-first", async () => {
    await app.inject({ method: "POST", url: "/session/request", payload: AGENT_REQUEST_BODY });
    await app.inject({ method: "POST", url: "/session/request", payload: MERCHANT_REQUEST_BODY });

    const response = await app.inject({ method: "GET", url: "/audit" });
    expect(response.statusCode).toBe(200);
    const { events } = response.json() as { events: AuditEvent[] };
    expect(events).toHaveLength(2);
    // Merchant auto-approve was recorded after the agent pending request.
    expect(events[0]).toMatchObject({ event: "session_approved", app_id: "merchant-demo" });
    expect(events[1]).toMatchObject({ event: "session_requested", app_id: "agent-demo" });
  });

  it("filters by app_id and caps with limit", async () => {
    await app.inject({ method: "POST", url: "/session/request", payload: AGENT_REQUEST_BODY });
    await app.inject({ method: "POST", url: "/session/request", payload: MERCHANT_REQUEST_BODY });
    await app.inject({ method: "POST", url: "/session/request", payload: AGENT_REQUEST_BODY });

    const filtered = await app.inject({ method: "GET", url: "/audit?app_id=agent-demo" });
    const filteredEvents = (filtered.json() as { events: AuditEvent[] }).events;
    expect(filteredEvents).toHaveLength(2);
    expect(filteredEvents.every((event) => event.app_id === "agent-demo")).toBe(true);

    const limited = await app.inject({ method: "GET", url: "/audit?limit=1" });
    expect((limited.json() as { events: AuditEvent[] }).events).toHaveLength(1);
  });

  it("rejects invalid query parameters", async () => {
    for (const url of ["/audit?limit=0", "/audit?limit=abc", "/audit?limit=-3", "/audit?appId=x"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(400);
      expect(response.json()).toMatchObject({ status: "blocked", reason: "INVALID_REQUEST" });
    }
  });

  it("records exactly one event per decision and nothing for non-decisions", async () => {
    // Six decisions, interleaved with reads and repeat/error calls that must add nothing.
    await app.inject({ method: "POST", url: "/session/request", payload: { app_id: "agent-demo" } });
    await app.inject({
      method: "POST",
      url: "/session/request",
      payload: { ...AGENT_REQUEST_BODY, app_id: "ghost-app" },
    });

    const pending = (
      await app.inject({ method: "POST", url: "/session/request", payload: AGENT_REQUEST_BODY })
    ).json() as { session_request_id: string };

    const approved = (
      await app.inject({
        method: "POST",
        url: "/session/approve",
        payload: { session_request_id: pending.session_request_id, approval_type: "session" },
      })
    ).json() as { session_id: string };

    // Non-decisions: re-approve (409), read current, both add no audit events.
    await app.inject({
      method: "POST",
      url: "/session/approve",
      payload: { session_request_id: pending.session_request_id, approval_type: "session" },
    });
    await app.inject({ method: "GET", url: `/session/current?session_id=${approved.session_id}` });

    await app.inject({
      method: "POST",
      url: "/session/revoke",
      payload: { session_id: approved.session_id },
    });
    // Idempotent revoke: no second event.
    await app.inject({
      method: "POST",
      url: "/session/revoke",
      payload: { session_id: approved.session_id },
    });

    await app.inject({ method: "POST", url: "/session/request", payload: MERCHANT_REQUEST_BODY });
    await app.inject({ method: "GET", url: "/audit" });

    const lines = readFileSync(join(dataDir, "audit.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as AuditEvent);

    expect(lines.map((event) => `${event.event}:${event.decision}:${event.reason}`)).toEqual([
      "session_requested:blocked:INVALID_REQUEST",
      "session_requested:blocked:APP_NOT_FOUND",
      "session_requested:allowed:APPROVAL_REQUIRED",
      "session_approved:allowed:WITHIN_POLICY",
      "session_revoked:allowed:WITHIN_POLICY",
      "session_approved:allowed:WITHIN_POLICY",
    ]);

    for (const event of lines) {
      expect(auditEventSchema.safeParse(event).success, JSON.stringify(event)).toBe(true);
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });

  it("merges history across a gateway restart", async () => {
    await app.inject({ method: "POST", url: "/session/request", payload: AGENT_REQUEST_BODY });
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
    await app.inject({ method: "POST", url: "/session/request", payload: MERCHANT_REQUEST_BODY });

    const { events } = (await app.inject({ method: "GET", url: "/audit" })).json() as {
      events: AuditEvent[];
    };
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.event)).toEqual(["session_approved", "session_requested"]);
  });
});
