import { RpcError } from "./errors.js";
import { listChannels } from "./methods/channels.js";
import { nodeInfo } from "./methods/info.js";
import { newInvoice } from "./methods/invoice.js";
import { getPayment, sendPayment } from "./methods/payment.js";
import type { MockState } from "./state.js";

export interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

/**
 * Fiber params are always a one-element array wrapping a named-field object
 * (`params: [ { … } ]`). A bare object is also accepted for convenience.
 */
function firstParam(params: unknown): Record<string, unknown> {
  if (Array.isArray(params)) {
    const head = params[0];
    return typeof head === "object" && head !== null ? (head as Record<string, unknown>) : {};
  }
  if (typeof params === "object" && params !== null) {
    return params as Record<string, unknown>;
  }
  return {};
}

/**
 * Routes a parsed JSON-RPC request to a method. Every call is recorded on
 * `state.calls` before execution so tests can prove which methods were reached.
 * Throws {@link RpcError} for protocol and domain failures.
 */
export function dispatch(state: MockState, request: JsonRpcRequest): unknown {
  const { method } = request;
  if (typeof method !== "string") {
    throw new RpcError(-32600, "invalid request: method must be a string");
  }
  state.calls.push({ method, params: request.params });

  const params = firstParam(request.params);
  switch (method) {
    case "node_info":
      return nodeInfo(state);
    case "new_invoice":
      return newInvoice(state, params);
    case "send_payment":
      return sendPayment(state, params);
    case "get_payment":
      return getPayment(state, params);
    case "list_channels":
      return listChannels(state, params);
    default:
      throw new RpcError(-32601, `method not found: ${method}`);
  }
}
