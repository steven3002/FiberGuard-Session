export const FIBERGUARD_ACTIONS = [
  "payment.pay_invoice",
  "invoice.create",
  "payment.read_own",
  "payments.read_all",
  "node.read",
  "channels.read_summary",
  "channel.open",
  "channel.close",
  "peer.connect",
] as const;

export type FiberGuardAction = (typeof FIBERGUARD_ACTIONS)[number];

/**
 * Actions the gateway maps to real Fiber RPC calls. Everything else terminates at
 * the policy check and must never produce an upstream request.
 */
export const IMPLEMENTED_ACTIONS: ReadonlySet<FiberGuardAction> = new Set([
  "payment.pay_invoice",
  "invoice.create",
  "payment.read_own",
  "node.read",
  "channels.read_summary",
]);

export const RESTRICTED_ACTIONS: ReadonlySet<FiberGuardAction> = new Set([
  "payments.read_all",
  "channel.open",
  "channel.close",
  "peer.connect",
]);

export function isFiberGuardAction(value: string): value is FiberGuardAction {
  return (FIBERGUARD_ACTIONS as readonly string[]).includes(value);
}
