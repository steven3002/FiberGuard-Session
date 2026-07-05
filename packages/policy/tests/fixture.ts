import { parsePolicy, type Policy } from "../src/index.js";

/**
 * Test policy mirroring the product example: agent (approval-gated payments),
 * merchant (invoice creation without payment authority), dashboard (read-only).
 */
export const FIXTURE_YAML = `
assets:
  RUSD:
    decimals: 8
    udt_type_script:
      code_hash: "0x${"ab".repeat(32)}"
      hash_type: type
      args: "0x01"
  CKB:
    decimals: 8
    native: true

apps:
  agent-demo:
    name: "Agent Demo"
    origins:
      - "http://localhost:3001"
    allow:
      - action: "payment.pay_invoice"
        assets: ["RUSD"]
        max_amount_per_payment: "1"
        daily_limit: "5"
        require_approval: true
        expires_in: "10m"
      - action: "payment.read_own"
    deny:
      - action: "channel.open"
      - action: "channel.close"
      - action: "peer.connect"
      - action: "payments.read_all"

  merchant-demo:
    name: "Merchant Demo"
    origins:
      - "http://localhost:3002"
    allow:
      - action: "invoice.create"
        assets: ["RUSD", "CKB"]
        max_amount_per_invoice: "100"
        require_approval: false
      - action: "payment.read_own"
    deny:
      - action: "channel.open"
      - action: "channel.close"

  dashboard-demo:
    name: "Read-only Dashboard"
    origins:
      - "http://localhost:3003"
    allow:
      - action: "node.read"
      - action: "channels.read_summary"
      - action: "payment.read_own"
    deny:
      - action: "payment.pay_invoice"
      - action: "invoice.create"
      - action: "channel.open"
      - action: "channel.close"
      - action: "peer.connect"
`;

export function fixturePolicy(): Policy {
  return parsePolicy(FIXTURE_YAML);
}
