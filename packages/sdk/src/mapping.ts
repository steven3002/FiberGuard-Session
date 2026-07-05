import type {
  ActionResult,
  ChannelSummaryResult,
  FiberGuardAction,
  GrantedPermission,
  InvoiceResult,
  NodeInfoResult,
  PaymentReadResult,
  PaymentResult,
  PermissionRequest,
} from "./types.js";

/** camelCase SDK permission → snake_case wire permission. */
export function toWirePermission(permission: PermissionRequest): Record<string, unknown> {
  return {
    action: permission.action,
    ...(permission.asset !== undefined ? { asset: permission.asset } : {}),
    ...(permission.maxAmountPerPayment !== undefined
      ? { max_amount_per_payment: permission.maxAmountPerPayment }
      : {}),
    ...(permission.maxAmountPerInvoice !== undefined
      ? { max_amount_per_invoice: permission.maxAmountPerInvoice }
      : {}),
    ...(permission.dailyLimit !== undefined ? { daily_limit: permission.dailyLimit } : {}),
    ...(permission.expiresIn !== undefined ? { expires_in: permission.expiresIn } : {}),
  };
}

/** snake_case wire granted permission → camelCase SDK permission. */
export function fromWirePermission(wire: Record<string, unknown>): GrantedPermission {
  return {
    action: wire.action as FiberGuardAction,
    ...(typeof wire.asset === "string" ? { asset: wire.asset } : {}),
    ...(typeof wire.max_amount_per_payment === "string"
      ? { maxAmountPerPayment: wire.max_amount_per_payment }
      : {}),
    ...(typeof wire.max_amount_per_invoice === "string"
      ? { maxAmountPerInvoice: wire.max_amount_per_invoice }
      : {}),
    ...(typeof wire.daily_limit === "string" ? { dailyLimit: wire.daily_limit } : {}),
  };
}

function asFiberResult(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function mapPayment(body: Record<string, unknown>): PaymentResult | null {
  if (body.status === "forwarded" && typeof body.payment_hash === "string") {
    return {
      decision: "allowed",
      status: "forwarded",
      paymentHash: body.payment_hash,
      fiberResult: asFiberResult(body.fiber_result),
    };
  }
  return null;
}

export function mapInvoice(body: Record<string, unknown>): InvoiceResult | null {
  if (body.status === "forwarded" && typeof body.invoice === "string") {
    return {
      decision: "allowed",
      status: "forwarded",
      invoiceAddress: body.invoice,
      fiberResult: asFiberResult(body.fiber_result),
    };
  }
  return null;
}

export function mapPaymentRead(body: Record<string, unknown>): PaymentReadResult | null {
  const payment = body.payment;
  if (body.status === "allowed" && typeof payment === "object" && payment !== null) {
    const record = payment as Record<string, unknown>;
    if (typeof record.payment_hash === "string" && typeof record.state === "string") {
      return { decision: "allowed", paymentHash: record.payment_hash, state: record.state };
    }
  }
  return null;
}

export function mapChannelSummary(body: Record<string, unknown>): ChannelSummaryResult | null {
  const summary = body.summary;
  if (body.status === "allowed" && typeof summary === "object" && summary !== null) {
    const record = summary as Record<string, unknown>;
    if (
      typeof record.total_channels === "number" &&
      typeof record.open_channels === "number" &&
      typeof record.closed_channels === "number"
    ) {
      return {
        decision: "allowed",
        totalChannels: record.total_channels,
        openChannels: record.open_channels,
        closedChannels: record.closed_channels,
      };
    }
  }
  return null;
}

export function mapNodeInfo(body: Record<string, unknown>): NodeInfoResult | null {
  if (body.status === "allowed" && typeof body.node === "object" && body.node !== null) {
    return { decision: "allowed", node: body.node as Record<string, unknown> };
  }
  return null;
}

export function mapAction(body: Record<string, unknown>): ActionResult | null {
  if (body.status === "allowed" || body.status === "forwarded") {
    return {
      decision: "allowed",
      status: String(body.status),
      ...(body.fiber_result !== undefined ? { fiberResult: asFiberResult(body.fiber_result) } : {}),
    };
  }
  return null;
}
