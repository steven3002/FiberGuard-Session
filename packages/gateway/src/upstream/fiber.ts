import { toBaseUnits } from "@fiberguard/shared";
import type { AssetConfig } from "@fiberguard/policy";
import { JsonRpcClient, UpstreamError } from "./rpc-client.js";

/** Encodes a base-unit integer as the 0x-hex string Fiber expects on the wire. */
function encodeU128(units: bigint): string {
  return `0x${units.toString(16)}`;
}

export interface PayInvoiceInput {
  invoice: string;
  /** Decimal amount string, already policy-validated. */
  amount: string;
  assetConfig: AssetConfig;
}

export interface CreateInvoiceInput {
  /** Decimal amount string, already policy-validated. */
  amount: string;
  assetConfig: AssetConfig;
  description?: string;
  /** Currency tag; defaults to testnet (`Fibt`). */
  currency?: string;
}

export interface PayInvoiceResult {
  payment_hash: string;
  fiber_result: Record<string, unknown>;
}

export interface CreateInvoiceResult {
  invoice_address: string;
  payment_hash?: string;
  fiber_result: Record<string, unknown>;
}

function asRecord(value: unknown, method: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new UpstreamError(`${method} returned a malformed result`, { method });
  }
  return value as Record<string, unknown>;
}

/**
 * Intent → Fiber RPC mapping. This module is the ONLY place decimal amounts
 * become base units (via `toBaseUnits`, using the per-asset decimals) and the
 * only place `udt_type_script` is attached — the base-unit boundary the rest of
 * the gateway is kept clear of.
 */
export class FiberClient {
  private readonly rpc: JsonRpcClient;

  constructor(endpoint: string) {
    this.rpc = new JsonRpcClient(endpoint);
  }

  async payInvoice(input: PayInvoiceInput): Promise<PayInvoiceResult> {
    const amount = encodeU128(toBaseUnits(input.amount, input.assetConfig.decimals));
    const params: Record<string, unknown> = { invoice: input.invoice, amount };
    if (input.assetConfig.udt_type_script !== undefined) {
      params.udt_type_script = input.assetConfig.udt_type_script;
    }
    const result = asRecord(await this.rpc.call("send_payment", params), "send_payment");
    const paymentHash = result.payment_hash;
    if (typeof paymentHash !== "string") {
      throw new UpstreamError("send_payment did not return a payment_hash");
    }
    return { payment_hash: paymentHash, fiber_result: result };
  }

  async createInvoice(input: CreateInvoiceInput): Promise<CreateInvoiceResult> {
    const amount = encodeU128(toBaseUnits(input.amount, input.assetConfig.decimals));
    const params: Record<string, unknown> = { amount, currency: input.currency ?? "Fibt" };
    if (input.description !== undefined) {
      params.description = input.description;
    }
    if (input.assetConfig.udt_type_script !== undefined) {
      params.udt_type_script = input.assetConfig.udt_type_script;
    }
    const result = asRecord(await this.rpc.call("new_invoice", params), "new_invoice");
    const invoiceAddress = result.invoice_address;
    if (typeof invoiceAddress !== "string") {
      throw new UpstreamError("new_invoice did not return an invoice_address");
    }
    const invoice = result.invoice;
    const paymentHash =
      typeof invoice === "object" && invoice !== null
        ? (invoice as Record<string, unknown>).payment_hash
        : undefined;
    return {
      invoice_address: invoiceAddress,
      ...(typeof paymentHash === "string" ? { payment_hash: paymentHash } : {}),
      fiber_result: result,
    };
  }

  async getPayment(paymentHash: string): Promise<Record<string, unknown>> {
    return asRecord(await this.rpc.call("get_payment", { payment_hash: paymentHash }), "get_payment");
  }

  async nodeInfo(): Promise<Record<string, unknown>> {
    return asRecord(await this.rpc.call("node_info", {}), "node_info");
  }

  async channelSummary(): Promise<{
    total_channels: number;
    open_channels: number;
    closed_channels: number;
  }> {
    const result = asRecord(
      await this.rpc.call("list_channels", { include_closed: true }),
      "list_channels",
    );
    const channels = Array.isArray(result.channels) ? result.channels : [];
    const closed = channels.filter((channel) => {
      const state = (channel as Record<string, unknown>)?.state;
      return typeof state === "string" && /clos/i.test(state);
    }).length;
    return {
      total_channels: channels.length,
      open_channels: channels.length - closed,
      closed_channels: closed,
    };
  }
}
