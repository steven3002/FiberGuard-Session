import { describe, expect, it } from "vitest";
import { FiberGuard, FiberGuardError, type FetchLike } from "../src/index.js";

type Canned = { status: number; body: unknown };
type Route = Canned | ((body: Record<string, unknown> | undefined) => Canned);

interface Call {
  key: string;
  body: Record<string, unknown> | undefined;
}

function harness(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0] as string;
    const key = `${method} ${path}`;
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ key, body });

    let route = routes[key];
    if (route === undefined) {
      const prefix = Object.keys(routes).find((candidate) => key.startsWith(candidate));
      route = prefix !== undefined ? routes[prefix] : undefined;
    }
    if (route === undefined) {
      throw new Error(`no canned response for ${key}`);
    }
    const canned = typeof route === "function" ? route(body) : route;
    return { status: canned.status, json: async () => canned.body };
  };
  const guard = new FiberGuard({
    gatewayUrl: "http://gw.test",
    appId: "agent-demo",
    origin: "http://localhost:3001",
    fetch: fetchImpl,
  });
  return { guard, calls };
}

const approved = { status: 200, body: { status: "approved", session_id: "sess_abcdefgh", expires_at: "2026-07-05T10:00:00.000Z" } };
const pending = { status: 200, body: { status: "pending_approval", session_request_id: "sr_abcdefgh", approval_url: "http://gw.test/approve/sr_abcdefgh" } };

describe("FiberGuard SDK (mocked fetch)", () => {
  it("maps camelCase permissions to the snake_case wire", async () => {
    const { guard, calls } = harness({ "POST /session/request": approved });
    await guard.requestSession({
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
    const perm = (calls[0].body!.requested_permissions as Record<string, unknown>[])[0];
    expect(perm).toEqual({
      action: "payment.pay_invoice",
      asset: "RUSD",
      max_amount_per_payment: "1",
      daily_limit: "5",
      expires_in: "10m",
    });
  });

  it("keeps a pending session inert until approval (no intent network call)", async () => {
    const { guard, calls } = harness({ "POST /session/request": pending });
    const session = await guard.requestSession({ permissions: [{ action: "payment.pay_invoice" }] });
    const result = await session.payInvoice({ invoice: "fibt1x", asset: "RUSD", amount: "0.5" });

    expect(result.decision).toBe("blocked");
    if (result.decision === "blocked") {
      expect(result.reason).toBe("SESSION_PENDING_APPROVAL");
    }
    expect(calls.some((c) => c.key === "POST /intent/pay-invoice")).toBe(false);
  });

  it("returns a typed PaymentResult for an allowed payment", async () => {
    const { guard } = harness({
      "POST /session/request": approved,
      "POST /intent/pay-invoice": {
        status: 200,
        body: {
          status: "forwarded",
          decision: "allowed",
          payment_hash: "0xdeadbeef",
          fiber_result: { status: "Success" },
        },
      },
    });
    const session = await guard.requestSession({ permissions: [{ action: "payment.pay_invoice" }] });
    const result = await session.payInvoice({ invoice: "fibt1x", asset: "RUSD", amount: "0.5" });

    expect(result).toEqual({
      decision: "allowed",
      status: "forwarded",
      paymentHash: "0xdeadbeef",
      fiberResult: { status: "Success" },
    });
  });

  it("returns a typed block for a policy-refused payment without throwing", async () => {
    const { guard } = harness({
      "POST /session/request": approved,
      "POST /intent/pay-invoice": {
        status: 403,
        body: { status: "blocked", decision: "blocked", reason: "AMOUNT_EXCEEDS_SESSION_LIMIT" },
      },
    });
    const session = await guard.requestSession({ permissions: [{ action: "payment.pay_invoice" }] });
    const result = await session.payInvoice({ invoice: "fibt1x", asset: "RUSD", amount: "100" });

    expect(result.decision).toBe("blocked");
    if (result.decision === "blocked") {
      expect(result.reason).toBe("AMOUNT_EXCEEDS_SESSION_LIMIT");
    }
  });

  it("treats UPSTREAM_FIBER_ERROR (HTTP 502) as a typed block, not a throw", async () => {
    const { guard } = harness({
      "POST /session/request": approved,
      "POST /intent/pay-invoice": {
        status: 502,
        body: { status: "blocked", decision: "blocked", reason: "UPSTREAM_FIBER_ERROR" },
      },
    });
    const session = await guard.requestSession({ permissions: [{ action: "payment.pay_invoice" }] });
    const result = await session.payInvoice({ invoice: "fibt1x", asset: "RUSD", amount: "0.5" });
    expect(result).toMatchObject({ decision: "blocked", reason: "UPSTREAM_FIBER_ERROR" });
  });

  it("throws FiberGuardError on a genuine 5xx with no blocked envelope", async () => {
    const { guard } = harness({
      "POST /session/request": approved,
      "POST /intent/pay-invoice": { status: 500, body: { error: "Internal Server Error" } },
    });
    const session = await guard.requestSession({ permissions: [{ action: "payment.pay_invoice" }] });
    await expect(
      session.payInvoice({ invoice: "fibt1x", asset: "RUSD", amount: "0.5" }),
    ).rejects.toBeInstanceOf(FiberGuardError);
  });

  it("throws FiberGuardError on a network failure", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };
    const guard = new FiberGuard({
      gatewayUrl: "http://gw.test",
      appId: "agent-demo",
      origin: "http://localhost:3001",
      fetch: fetchImpl,
    });
    await expect(guard.requestSession({ permissions: [{ action: "node.read" }] })).rejects.toBeInstanceOf(
      FiberGuardError,
    );
  });

  it("throws FiberGuardError carrying the reason when a session request is refused", async () => {
    const { guard } = harness({
      "POST /session/request": {
        status: 403,
        body: { status: "blocked", decision: "blocked", reason: "APP_NOT_FOUND" },
      },
    });
    await expect(guard.requestSession({ permissions: [{ action: "node.read" }] })).rejects.toMatchObject({
      name: "FiberGuardError",
      reason: "APP_NOT_FOUND",
    });
  });

  it("maps channel summary from snake_case to camelCase", async () => {
    const { guard } = harness({
      "POST /session/request": approved,
      "GET /channels/summary": {
        status: 200,
        body: {
          status: "allowed",
          summary: { total_channels: 3, open_channels: 2, closed_channels: 1 },
        },
      },
    });
    const session = await guard.requestSession({ permissions: [{ action: "channels.read_summary" }] });
    const result = await session.getChannelSummary();
    expect(result).toEqual({
      decision: "allowed",
      totalChannels: 3,
      openChannels: 2,
      closedChannels: 1,
    });
  });

  it("waitForApproval polls until approved and adopts the session id", async () => {
    let polls = 0;
    const fetchImpl: FetchLike = async (url, init) => {
      const method = init?.method ?? "GET";
      const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0] as string;
      if (method === "POST" && path === "/session/request") {
        return { status: 200, json: async () => pending.body };
      }
      if (method === "GET" && path.startsWith("/session/request/")) {
        polls += 1;
        const body =
          polls < 2
            ? { status: "pending" }
            : { status: "approved", session_id: "sess_approved1" };
        return { status: 200, json: async () => body };
      }
      throw new Error(`unexpected ${method} ${path}`);
    };
    const guard = new FiberGuard({
      gatewayUrl: "http://gw.test",
      appId: "agent-demo",
      origin: "http://localhost:3001",
      fetch: fetchImpl,
    });
    const session = await guard.requestSession({ permissions: [{ action: "payment.pay_invoice" }] });
    expect(session.isActive).toBe(false);
    await session.waitForApproval({ intervalMs: 1, timeoutMs: 1000 });
    expect(session.isActive).toBe(true);
    expect(session.sessionId).toBe("sess_approved1");
    expect(polls).toBeGreaterThanOrEqual(2);
  });

  it("getCurrentSession returns null when the gateway reports SESSION_NOT_FOUND", async () => {
    const { guard } = harness({
      "GET /session/current": {
        status: 404,
        body: { status: "blocked", decision: "blocked", reason: "SESSION_NOT_FOUND" },
      },
    });
    expect(await guard.getCurrentSession("sess_missing0")).toBeNull();
  });

  it("revoke resolves to an allowed revoked result", async () => {
    const { guard } = harness({
      "POST /session/request": approved,
      "POST /session/revoke": { status: 200, body: { status: "revoked", session_id: "sess_abcdefgh" } },
    });
    const session = await guard.requestSession({ permissions: [{ action: "payment.pay_invoice" }] });
    expect(await session.revoke()).toEqual({ decision: "allowed", status: "revoked" });
  });
});
