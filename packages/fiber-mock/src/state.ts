import { randomBytes } from "node:crypto";
import { toHex } from "./hex.js";

export type ChannelStateTag = "CHANNEL_READY" | "CLOSED";

export interface MockChannel {
  channel_id: string;
  state: ChannelStateTag;
  is_public: boolean;
  /** hex u128 */
  local_balance: string;
  /** hex u128 */
  remote_balance: string;
  /** hex u64 milliseconds */
  created_at: string;
  enabled: boolean;
}

export interface MockInvoice {
  invoice_address: string;
  payment_hash: string;
  /** hex u128 */
  amount: string;
  currency: string;
  description?: string;
  udt_type_script?: unknown;
  status: "Open" | "Paid";
}

export interface MockPayment {
  payment_hash: string;
  status: "Success";
  /** hex u64 milliseconds */
  created_at: string;
  last_updated_at: string;
  /** hex u128 */
  fee: string;
  /** hex u128 */
  amount: string;
  udt_type_script?: unknown;
}

export interface RpcCall {
  method: string;
  params: unknown;
}

/**
 * In-memory node state. Invoices and payments accumulate as requests arrive;
 * channels are seeded once. `calls` records every dispatched RPC so tests can
 * assert that policy-blocked intents never reach the upstream.
 */
export interface MockState {
  nodeName: string;
  pubkey: string;
  chainHash: string;
  channels: MockChannel[];
  invoices: Map<string, MockInvoice>;
  paymentsByHash: Map<string, MockPayment>;
  calls: RpcCall[];
}

export function randomHash(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

function randomPubkey(): string {
  return `0x${randomBytes(33).toString("hex")}`;
}

/**
 * Seeds the deterministic demo topology: two ready channels and one closed one,
 * so `list_channels(include_closed:true)` reduces to the dashboard's {3,2,1}.
 */
export function createInitialState(): MockState {
  const createdAt = toHex(BigInt(Date.UTC(2026, 0, 1)));
  const channel = (state: ChannelStateTag, local: bigint, remote: bigint): MockChannel => ({
    channel_id: randomHash(),
    state,
    is_public: true,
    local_balance: toHex(local),
    remote_balance: toHex(remote),
    created_at: createdAt,
    enabled: state === "CHANNEL_READY",
  });
  return {
    nodeName: "fiberguard-mock-node",
    pubkey: randomPubkey(),
    chainHash: randomHash(),
    channels: [
      channel("CHANNEL_READY", 100_000_000n, 50_000_000n),
      channel("CHANNEL_READY", 250_000_000n, 0n),
      channel("CLOSED", 0n, 0n),
    ],
    invoices: new Map(),
    paymentsByHash: new Map(),
    calls: [],
  };
}
