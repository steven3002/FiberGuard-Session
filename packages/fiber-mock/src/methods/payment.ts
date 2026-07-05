import { RpcError } from "../errors.js";
import { fromHex, toHex } from "../hex.js";
import { randomHash, type MockPayment, type MockState } from "../state.js";

interface SendPaymentParams {
  invoice?: unknown;
  amount?: unknown;
  payment_hash?: unknown;
  udt_type_script?: unknown;
}

/**
 * `send_payment`: settles a known invoice (or an ad-hoc amount) and immediately
 * reports Success — the mock has no routing or inflight states to model.
 */
export function sendPayment(state: MockState, params: SendPaymentParams): Record<string, unknown> {
  const invoice =
    typeof params.invoice === "string" ? state.invoices.get(params.invoice) : undefined;

  let amountHex: string;
  if (params.amount !== undefined) {
    try {
      amountHex = toHex(fromHex(params.amount));
    } catch {
      throw new RpcError(-32602, "send_payment amount must be a 0x-hex string");
    }
  } else if (invoice !== undefined) {
    amountHex = invoice.amount;
  } else {
    throw new RpcError(-32602, "send_payment requires an amount or a known invoice");
  }

  const paymentHash =
    invoice?.payment_hash ??
    (typeof params.payment_hash === "string" ? params.payment_hash : randomHash());
  const nowMs = toHex(BigInt(Date.now()));
  const payment: MockPayment = {
    payment_hash: paymentHash,
    status: "Success",
    created_at: nowMs,
    last_updated_at: nowMs,
    fee: "0x0",
    amount: amountHex,
    ...(params.udt_type_script !== undefined ? { udt_type_script: params.udt_type_script } : {}),
  };
  state.paymentsByHash.set(paymentHash, payment);
  if (invoice !== undefined) {
    invoice.status = "Paid";
  }
  return { ...payment };
}

/** `get_payment`: returns a previously settled payment, or a not-found error. */
export function getPayment(
  state: MockState,
  params: { payment_hash?: unknown },
): Record<string, unknown> {
  if (typeof params.payment_hash !== "string") {
    throw new RpcError(-32602, "get_payment requires a payment_hash");
  }
  const payment = state.paymentsByHash.get(params.payment_hash);
  if (payment === undefined) {
    throw new RpcError(-32001, `payment ${params.payment_hash} not found`);
  }
  return { ...payment };
}
