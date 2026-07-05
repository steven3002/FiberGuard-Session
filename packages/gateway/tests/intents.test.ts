import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, InjectPayload } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPolicy } from "@fiberguard/policy";
import { startMockNode, type MockNodeHandle } from "@fiberguard/fiber-mock";
import { buildApp } from "../src/server/app.js";
import { resolveConfig } from "../src/config.js";

const EXAMPLE_POLICY = fileURLToPath(new URL("../../../examples/fiberguard.yml", import.meta.url));
const policy = loadPolicy(EXAMPLE_POLICY);
const INVOICE = "fibt1testinvoice0001";

function gateway(upstream: string, dataDir: string): Promise<FastifyInstance> {
  return buildApp({
    config: resolveConfig({ upstream, port: "8787", policy: EXAMPLE_POLICY, data: dataDir }),
    policy,
  });
}

const post = (app: FastifyInstance, url: string, payload: InjectPayload) =>
  app.inject({ method: "POST", url, payload });
const get = (app: FastifyInstance, url: string) => app.inject({ method: "GET", url });

async function agentSession(app: FastifyInstance, approvalType: "session" | "once" = "session") {
  const requested = await post(app, "/session/request", {
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
      { action: "payment.read_own" },
    ],
  });
  const { session_request_id } = requested.json() as { session_request_id: string };
  const approved = await post(app, "/session/approve", {
    session_request_id,
    approval_type: approvalType,
  });
  return (approved.json() as { session_id: string }).session_id;
}

async function autoApprovedSession(app: FastifyInstance, body: InjectPayload) {
  const response = await post(app, "/session/request", body);
  return (response.json() as { session_id: string }).session_id;
}

const merchantSession = (app: FastifyInstance) =>
  autoApprovedSession(app, {
    app_id: "merchant-demo",
    origin: "http://localhost:3002",
    requested_permissions: [{ action: "invoice.create" }],
  });

const dashboardSession = (app: FastifyInstance) =>
  autoApprovedSession(app, {
    app_id: "dashboard-demo",
    origin: "http://localhost:3003",
    requested_permissions: [
      { action: "node.read" },
      { action: "channels.read_summary" },
      { action: "payment.read_own" },
    ],
  });

const payAgent = (app: FastifyInstance, sessionId: string, amount: string) =>
  post(app, "/intent/pay-invoice", {
    session_id: sessionId,
    app_id: "agent-demo",
    origin: "http://localhost:3001",
    invoice: INVOICE,
    asset: "RUSD",
    amount,
  });

const upstreamCalls = (node: MockNodeHandle, method: string) =>
  node.state.calls.filter((call) => call.method === method).length;

describe("intent pipeline (§16 demo end to end)", () => {
  let app: FastifyInstance;
  let node: MockNodeHandle;
  let dataDir: string;

  beforeEach(async () => {
    node = await startMockNode({ port: 0 });
    dataDir = mkdtempSync(join(tmpdir(), "fiberguard-intents-"));
    app = await gateway(node.url, dataDir);
  });

  afterEach(async () => {
    await app.close();
    await node.close();
  });

  it("forwards an in-limit agent payment and records spend + ownership", async () => {
    const session = await agentSession(app);
    const response = await payAgent(app, session, "0.5");
    expect(response.statusCode).toBe(200);

    const body = response.json() as { status: string; payment_hash: string };
    expect(body.status).toBe("forwarded");
    expect(body.payment_hash).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(node.state.paymentsByHash.has(body.payment_hash)).toBe(true);

    // Ownership was recorded: the same session may read its own payment.
    const read = await get(app, `/payments/${body.payment_hash}?session_id=${session}`);
    expect(read.statusCode).toBe(200);
    expect((read.json() as { payment: { state: string } }).payment.state).toBe("Success");
  });

  it("blocks a payment above the per-payment cap without reaching upstream", async () => {
    const session = await agentSession(app);
    const before = upstreamCalls(node, "send_payment");

    const response = await payAgent(app, session, "100");
    expect(response.statusCode).toBe(403);
    expect((response.json() as { reason: string }).reason).toBe("AMOUNT_EXCEEDS_SESSION_LIMIT");
    expect(upstreamCalls(node, "send_payment")).toBe(before);
  });

  it("enforces the cumulative daily limit across payments", async () => {
    const session = await agentSession(app);
    for (let i = 0; i < 5; i += 1) {
      expect((await payAgent(app, session, "1")).statusCode).toBe(200);
    }
    const sixth = await payAgent(app, session, "1");
    expect(sixth.statusCode).toBe(403);
    expect((sixth.json() as { reason: string }).reason).toBe("AMOUNT_EXCEEDS_DAILY_LIMIT");
  });

  it("blocks an explicitly denied action via /intent/action without forwarding", async () => {
    const session = await agentSession(app);
    const before = node.state.calls.length;

    const response = await post(app, "/intent/action", {
      session_id: session,
      app_id: "agent-demo",
      origin: "http://localhost:3001",
      action: "channel.open",
    });
    expect(response.statusCode).toBe(403);
    expect((response.json() as { reason: string }).reason).toBe("ACTION_EXPLICITLY_DENIED");
    expect(node.state.calls.length).toBe(before);
  });

  it("lets the merchant create an invoice but not send a payment", async () => {
    const session = await merchantSession(app);

    const created = await post(app, "/intent/create-invoice", {
      session_id: session,
      app_id: "merchant-demo",
      origin: "http://localhost:3002",
      asset: "RUSD",
      amount: "10",
      description: "demo invoice",
    });
    expect(created.statusCode).toBe(200);
    expect((created.json() as { invoice: string }).invoice).toMatch(/^fibt1/);

    const pay = await post(app, "/intent/pay-invoice", {
      session_id: session,
      app_id: "merchant-demo",
      origin: "http://localhost:3002",
      invoice: INVOICE,
      asset: "RUSD",
      amount: "1",
    });
    expect(pay.statusCode).toBe(403);
    expect((pay.json() as { reason: string }).reason).toBe("ACTION_NOT_ALLOWED");
  });

  it("serves dashboard node info and the {3,2,1} channel summary", async () => {
    const session = await dashboardSession(app);

    const node_info = await get(app, `/node/info?session_id=${session}`);
    expect(node_info.statusCode).toBe(200);
    expect((node_info.json() as { node: { node_name: string } }).node.node_name).toBe(
      "fiberguard-mock-node",
    );

    const summary = await get(app, `/channels/summary?session_id=${session}`);
    expect(summary.statusCode).toBe(200);
    expect((summary.json() as { summary: unknown }).summary).toEqual({
      total_channels: 3,
      open_channels: 2,
      closed_channels: 1,
    });
  });

  it("blocks reading a payment the session does not own, before upstream", async () => {
    const session = await dashboardSession(app);
    const foreignHash = `0x${"ab".repeat(32)}`;
    const before = upstreamCalls(node, "get_payment");

    const response = await get(app, `/payments/${foreignHash}?session_id=${session}`);
    expect(response.statusCode).toBe(403);
    expect((response.json() as { reason: string }).reason).toBe("PAYMENT_NOT_OWNED_BY_SESSION");
    expect(upstreamCalls(node, "get_payment")).toBe(before);
  });

  it("blocks payments on a revoked session", async () => {
    const session = await agentSession(app);
    await post(app, "/session/revoke", { session_id: session });

    const response = await payAgent(app, session, "0.5");
    expect(response.statusCode).toBe(403);
    expect((response.json() as { reason: string }).reason).toBe("SESSION_REVOKED");
  });

  it("consumes a one-shot session after its first allowed intent", async () => {
    const session = await agentSession(app, "once");

    expect((await payAgent(app, session, "0.5")).statusCode).toBe(200);

    const second = await payAgent(app, session, "0.5");
    expect(second.statusCode).toBe(403);
    expect((second.json() as { reason: string }).reason).toBe("SESSION_EXPIRED");
  });

  it("records exactly one audit event per intent decision", async () => {
    const session = await agentSession(app);
    await payAgent(app, session, "0.5"); // allowed
    await payAgent(app, session, "100"); // blocked (session limit)

    const audit = await get(app, "/audit?app_id=agent-demo");
    const events = (audit.json() as { events: { event: string; reason: string }[] }).events;
    const intentEvents = events.filter((e) => e.event.startsWith("intent_"));

    expect(intentEvents.filter((e) => e.reason === "WITHIN_POLICY")).toHaveLength(1);
    expect(intentEvents.filter((e) => e.reason === "AMOUNT_EXCEEDS_SESSION_LIMIT")).toHaveLength(1);
  });
});

describe("intent pipeline (upstream unavailable)", () => {
  it("wraps an unreachable Fiber node as UPSTREAM_FIBER_ERROR", async () => {
    const dead = await startMockNode({ port: 0 });
    const deadUrl = dead.url;
    await dead.close(); // nothing listens on deadUrl now

    const dataDir = mkdtempSync(join(tmpdir(), "fiberguard-upstream-down-"));
    const app = await gateway(deadUrl, dataDir);
    try {
      const session = await agentSession(app);
      const response = await payAgent(app, session, "0.5");
      expect(response.statusCode).toBe(502);
      expect((response.json() as { reason: string }).reason).toBe("UPSTREAM_FIBER_ERROR");
    } finally {
      await app.close();
    }
  });
});
