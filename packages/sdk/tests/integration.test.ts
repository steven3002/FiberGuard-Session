import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPolicy } from "@fiberguard/policy";
import { buildApp, resolveConfig } from "@fiberguard/gateway";
import { startMockNode, type MockNodeHandle } from "@fiberguard/fiber-mock";
import { FiberGuard } from "../src/index.js";

const EXAMPLE_POLICY = fileURLToPath(new URL("../../../examples/fiberguard.yml", import.meta.url));

async function approve(baseUrl: string, sessionRequestId: string, type: "session" | "once"): Promise<void> {
  await fetch(`${baseUrl}/session/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_request_id: sessionRequestId, approval_type: type }),
  });
}

const AGENT_PERMS = [
  { action: "payment.pay_invoice", asset: "RUSD", maxAmountPerPayment: "1", dailyLimit: "5", expiresIn: "10m" },
] as const;

describe("SDK against a live gateway + mock", () => {
  let app: FastifyInstance;
  let node: MockNodeHandle;
  let baseUrl: string;

  beforeEach(async () => {
    node = await startMockNode({ port: 0 });
    const dataDir = mkdtempSync(join(tmpdir(), "fiberguard-sdk-"));
    app = await buildApp({
      config: resolveConfig({ upstream: node.url, port: "8787", policy: EXAMPLE_POLICY, data: dataDir }),
      policy: loadPolicy(EXAMPLE_POLICY),
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await app.close();
    await node.close();
  });

  it("runs the product-doc §13 example verbatim (agent pending → typed block, no throw)", async () => {
    const guard = new FiberGuard({
      gatewayUrl: baseUrl,
      appId: "agent-demo",
      origin: "http://localhost:3001",
    });

    const session = await guard.requestSession({
      permissions: [
        {
          action: "payment.pay_invoice",
          asset: "RUSD",
          maxAmountPerPayment: "1",
          dailyLimit: "5",
          expiresIn: "10m",
        },
      ],
    });

    const payment = await session.payInvoice({
      invoice: "fibt1...",
      asset: "RUSD",
      amount: "0.5",
      reason: "Pay for API request",
    });

    expect(payment).toMatchObject({ decision: "blocked", reason: "SESSION_PENDING_APPROVAL" });
    expect(session.approvalUrl).toContain("/approve/");
  });

  it("completes the approved agent flow: waitForApproval → pay → read own payment", async () => {
    const guard = new FiberGuard({
      gatewayUrl: baseUrl,
      appId: "agent-demo",
      origin: "http://localhost:3001",
    });
    const session = await guard.requestSession({
      permissions: [...AGENT_PERMS, { action: "payment.read_own" }],
    });
    await approve(baseUrl, session.sessionRequestId as string, "session");
    await session.waitForApproval({ intervalMs: 5, timeoutMs: 5000 });
    expect(session.isActive).toBe(true);

    const paid = await session.payInvoice({ invoice: "fibt1demo", asset: "RUSD", amount: "0.5" });
    expect(paid.decision).toBe("allowed");
    if (paid.decision === "allowed") {
      expect(paid.paymentHash).toMatch(/^0x[0-9a-f]{64}$/i);
      const read = await session.getPayment(paid.paymentHash);
      expect(read).toMatchObject({ decision: "allowed", state: "Success" });
    }
  });

  it("reports SESSION_REVOKED after revoke", async () => {
    const guard = new FiberGuard({
      gatewayUrl: baseUrl,
      appId: "agent-demo",
      origin: "http://localhost:3001",
    });
    const session = await guard.requestSession({ permissions: [...AGENT_PERMS] });
    await approve(baseUrl, session.sessionRequestId as string, "session");
    await session.waitForApproval({ intervalMs: 5, timeoutMs: 5000 });

    expect(await session.revoke()).toEqual({ decision: "allowed", status: "revoked" });
    const afterRevoke = await session.payInvoice({ invoice: "fibt1demo", asset: "RUSD", amount: "0.5" });
    expect(afterRevoke).toMatchObject({ decision: "blocked", reason: "SESSION_REVOKED" });
  });

  it("merchant auto-approves, creates an invoice, and is refused a payment", async () => {
    const guard = new FiberGuard({
      gatewayUrl: baseUrl,
      appId: "merchant-demo",
      origin: "http://localhost:3002",
    });
    const session = await guard.requestSession({ permissions: [{ action: "invoice.create" }] });
    expect(session.isActive).toBe(true);

    const invoice = await session.createInvoice({ asset: "RUSD", amount: "10", description: "demo" });
    expect(invoice.decision).toBe("allowed");
    if (invoice.decision === "allowed") {
      expect(invoice.invoiceAddress).toMatch(/^fibt1/);
    }

    const pay = await session.payInvoice({ invoice: "fibt1demo", asset: "RUSD", amount: "1" });
    expect(pay).toMatchObject({ decision: "blocked", reason: "ACTION_NOT_ALLOWED" });
  });

  it("dashboard reads node info and the {3,2,1} channel summary", async () => {
    const guard = new FiberGuard({
      gatewayUrl: baseUrl,
      appId: "dashboard-demo",
      origin: "http://localhost:3003",
    });
    const session = await guard.requestSession({
      permissions: [{ action: "node.read" }, { action: "channels.read_summary" }],
    });

    const nodeInfo = await session.getNodeInfo();
    expect(nodeInfo.decision).toBe("allowed");
    if (nodeInfo.decision === "allowed") {
      expect(nodeInfo.node.node_name).toBe("fiberguard-mock-node");
    }

    const summary = await session.getChannelSummary();
    expect(summary).toEqual({
      decision: "allowed",
      totalChannels: 3,
      openChannels: 2,
      closedChannels: 1,
    });
  });

  it("blocks a restricted action driven through tryAction", async () => {
    const guard = new FiberGuard({
      gatewayUrl: baseUrl,
      appId: "agent-demo",
      origin: "http://localhost:3001",
    });
    const session = await guard.requestSession({ permissions: [...AGENT_PERMS] });
    await approve(baseUrl, session.sessionRequestId as string, "session");
    await session.waitForApproval({ intervalMs: 5, timeoutMs: 5000 });

    const result = await session.tryAction("channel.open");
    expect(result).toMatchObject({ decision: "blocked", reason: "ACTION_EXPLICITLY_DENIED" });
  });
});
