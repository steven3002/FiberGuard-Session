import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startMockNode, toHex, type MockNodeHandle } from "../src/index.js";

async function rpc(url: string, method: string, params: Record<string, unknown> = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "1", method, params: [params] }),
  });
  return response.json() as Promise<{ result?: any; error?: { code: number; message: string } }>;
}

describe("fiber-mock JSON-RPC node", () => {
  let node: MockNodeHandle;

  beforeEach(async () => {
    node = await startMockNode({ port: 0 });
  });

  afterEach(async () => {
    await node.close();
  });

  it("reports node identity with hex-encoded counts", async () => {
    const { result } = await rpc(node.url, "node_info");
    expect(result.node_name).toBe("fiberguard-mock-node");
    expect(result.channel_count).toMatch(/^0x[0-9a-f]+$/);
    expect(result.peers_count).toBe("0x1");
  });

  it("seeds channels so include_closed yields the {3,2,1} summary", async () => {
    const all = await rpc(node.url, "list_channels", { include_closed: true });
    expect(all.result.channels).toHaveLength(3);
    const open = all.result.channels.filter((c: any) => c.state !== "CLOSED");
    expect(open).toHaveLength(2);

    const visible = await rpc(node.url, "list_channels", {});
    expect(visible.result.channels).toHaveLength(2);
  });

  it("mints an invoice whose address is currency-prefixed and settles it on payment", async () => {
    const invoice = await rpc(node.url, "new_invoice", {
      amount: toHex(200n),
      currency: "Fibt",
    });
    expect(invoice.result.invoice_address).toMatch(/^fibt1/);
    expect(invoice.result.invoice.amount).toBe("0xc8");
    const paymentHash = invoice.result.invoice.payment_hash as string;

    const payment = await rpc(node.url, "send_payment", {
      invoice: invoice.result.invoice_address,
    });
    expect(payment.result.status).toBe("Success");
    expect(payment.result.payment_hash).toBe(paymentHash);

    const fetched = await rpc(node.url, "get_payment", { payment_hash: paymentHash });
    expect(fetched.result.status).toBe("Success");
    expect(fetched.result.amount).toBe("0xc8");
  });

  it("returns a JSON-RPC error for an unknown payment hash", async () => {
    const missing = await rpc(node.url, "get_payment", { payment_hash: `0x${"ab".repeat(32)}` });
    expect(missing.result).toBeUndefined();
    expect(missing.error?.code).toBe(-32001);
  });

  it("returns method-not-found for an unknown method", async () => {
    const unknown = await rpc(node.url, "open_channel", {});
    expect(unknown.error?.code).toBe(-32601);
  });

  it("records every received call", async () => {
    await rpc(node.url, "node_info");
    await rpc(node.url, "list_channels", { include_closed: true });
    expect(node.state.calls.map((call) => call.method)).toEqual(["node_info", "list_channels"]);
  });
});
