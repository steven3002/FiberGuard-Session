# FiberGuard Session

**Scoped, revocable, spend-limited payment sessions for Fiber apps.**

FiberGuard Session is a scoped payment-intent gateway for Fiber. It lets wallets,
browser apps, merchant tools, dashboards, and AI agents request limited Fiber
capabilities through app sessions with spend limits, asset limits, approval
prompts, expiration, revocation, and audit logs. Instead of giving apps broad raw
Fiber RPC access, FiberGuard turns node access into safer, user-approved payment
intents.

---

## Problem

Fiber applications talk to a Fiber Network node over JSON-RPC. That interface is
powerful — it can create invoices, send payments, open and close channels, connect
peers, and read channel data. External apps need *some* of those capabilities, but
they should not receive broad raw RPC authority. What's missing is a higher-level
layer: per-app permissions, per-payment and daily spend limits, allowed assets,
approval prompts, origin checks, revocation, and an audit trail.

## Solution

FiberGuard Session is a local gateway, policy engine, SDK, approval UI, and audit
log that sits between apps and the node:

```
App  →  FiberGuard SDK  →  FiberGuard Gateway  →  Fiber JSON-RPC  →  Fiber Node
```

Apps call safe, high-level **intents** (pay an invoice, create an invoice, read a
payment) instead of raw RPC. The gateway checks each intent against a YAML policy
and the app's session, forwards only what's allowed, and records every decision.

## Architecture

```
   Browser app (agent / merchant / dashboard, own origin :300x)
        │  @fiberguard/session SDK (typed intents, cross-origin fetch)
        ▼
   ┌──────────────── FiberGuard Gateway (:8787) ─────────────────┐
   │  /session/*  /intent/*  /payments  /channels  /node  /audit │
   │  ── ordered policy checks ──►  forward | block  ──► audit    │
   │  local state: sessions · spend · ownership · audit · policy  │
   │  Approval UI (Next.js static export) at / and /approve/:id   │
   └───────────────────────────┬─────────────────────────────────┘
                               │  Fiber JSON-RPC 2.0
                               ▼
                 Fiber node (real, or bundled mock :8227)
```

See [docs/architecture.md](./docs/architecture.md) for the full picture.

## Features

- **Scoped sessions** — an app gets exactly the actions, assets, and limits the
  policy grants, nothing more.
- **Payment intents** — `pay_invoice`, `create_invoice`, `read_own`, `node.read`,
  `channels.read_summary`; raw RPC is never exposed.
- **Spend limits** — per-payment / per-invoice caps and per-app daily limits (UTC
  day), enforced before forwarding.
- **Approval prompts** — approval-gated sessions require the node owner to Approve
  (once or for the session) or Deny in a local UI.
- **Expiration & revocation** — sessions lapse at their TTL and can be revoked
  instantly.
- **Audit log** — one record per decision, allowed or blocked, with reason codes.
- **Typed SDK** — `@fiberguard/session`, isomorphic, blocked decisions returned as
  typed results.

## Quick start

Requires Node ≥ 20 and pnpm.

```bash
pnpm install
pnpm demo          # builds, then starts mock node + gateway + approval UI + 3 demos
```

Then open the demos and walk through [examples/demo-script.md](./examples/demo-script.md):

| Service | URL |
| --- | --- |
| Operator console / approval UI | http://localhost:8787/ |
| Agent demo | http://localhost:3001 |
| Merchant demo | http://localhost:3002 |
| Dashboard demo | http://localhost:3003 |

Or run the pieces individually:

```bash
pnpm build         # build packages + approval UI
pnpm mock          # mock Fiber node on :8227
pnpm gateway       # gateway + approval UI on :8787
```

Run the gateway directly with the documented flags:

```bash
node packages/gateway/dist/cli.js start \
  --upstream http://127.0.0.1:8227 \
  --port 8787 \
  --policy ./examples/fiberguard.yml \
  --approval-ui apps/approval-ui/out
```

### Run against a real Fiber testnet node

```bash
pnpm demo:testnet
```

This downloads the `fnn` binary, boots a **real Fiber testnet node**, points the
gateway at it (`examples/fiberguard.testnet.yml`, real RUSD UDT script), runs the
story against the live node, and asks whether to leave the stack up. The gateway
needs **no code changes** for a real node — only the upstream URL and asset config
differ. Reads, invoice creation, and every policy block are fully real out of the
box; a *settled* payment additionally needs a funded channel. Full guide:
[docs/testnet.md](./docs/testnet.md). Honest boundaries:
[docs/security-limitations.md](./docs/security-limitations.md).

## Policy example

```yaml
apps:
  agent-demo:
    name: "Agent Demo"
    origins: ["http://localhost:3001"]
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
```

Full policy: [examples/fiberguard.yml](./examples/fiberguard.yml). Model and the
ordered decision checks: [docs/policy-model.md](./docs/policy-model.md).

## API examples

```bash
# Request a session (approval-gated → returns an approval_url)
curl -X POST http://localhost:8787/session/request -H 'content-type: application/json' -d '{
  "app_id": "agent-demo", "origin": "http://localhost:3001",
  "requested_permissions": [
    { "action": "payment.pay_invoice", "asset": "RUSD",
      "max_amount_per_payment": "1", "daily_limit": "5", "expires_in": "10m" }
  ]
}'

# Pay an invoice (allowed → forwarded to Fiber)
curl -X POST http://localhost:8787/intent/pay-invoice -H 'content-type: application/json' -d '{
  "session_id": "sess_…", "app_id": "agent-demo", "origin": "http://localhost:3001",
  "invoice": "fibt1…", "asset": "RUSD", "amount": "0.5", "reason": "Pay for API request"
}'
```

Every endpoint with real captured responses: [examples/curl-examples.md](./examples/curl-examples.md)
and [docs/api-reference.md](./docs/api-reference.md).

## SDK example

```ts
import { FiberGuard } from "@fiberguard/session";

const guard = new FiberGuard({
  gatewayUrl: "http://localhost:8787",
  appId: "agent-demo",
  origin: "http://localhost:3001",
});

const session = await guard.requestSession({
  permissions: [
    { action: "payment.pay_invoice", asset: "RUSD",
      maxAmountPerPayment: "1", dailyLimit: "5", expiresIn: "10m" },
  ],
});

// Approval-gated? Wait for the owner to approve in the UI.
if (session.status === "pending_approval") {
  console.log("Approve at:", session.approvalUrl);
  await session.waitForApproval();
}

const payment = await session.payInvoice({
  invoice: "fibt1…", asset: "RUSD", amount: "0.5", reason: "Pay for API request",
});
console.log(payment); // { paymentHash, ... } — blocked decisions come back typed, not thrown
```

## Demo script

The full §16 story — agent pays within limit, is blocked over limit and on
forbidden actions; merchant creates invoices but can't pay; dashboard reads but
can't close channels; the agent session is revoked and further payment is blocked;
the audit log shows all of it — is in [examples/demo-script.md](./examples/demo-script.md).

## What is working

- Local gateway starts from the CLI and connects to a Fiber RPC endpoint.
- YAML policy is parsed and enforced (ordered checks, default-deny).
- Apps request sessions; owner can approve (once/session) or deny.
- Per-payment and daily spend limits are enforced; forbidden actions are blocked.
- Sessions expire and can be revoked.
- Audit log records allowed and blocked intents with reason codes.
- The typed SDK drives all three demo apps (agent, merchant, read-only dashboard),
  each on its own origin, cross-origin to the gateway.

## What is simulated or limited

- The default demo runs against a **bundled mock Fiber node**, not a live node. The
  mock matches Fiber's JSON-RPC shape but does not settle real value.
- The example RUSD `udt_type_script` is a placeholder; real-node use needs the real
  script, decimals, and testnet invoice encoding.
- Policy and session storage are local JSON/JSONL files.
- Origin checks are demo-grade (the gateway trusts the request's `origin`).
- This is a hackathon-grade implementation, not a production-audited security system.

## Security limitations

FiberGuard Session is a hackathon-grade local permission gateway. It is **not
production-audited** and should not be used to secure large amounts of funds
without further review. Full disclosure — local storage, demo-grade origin checks,
no formal audit, and Biscuit/browser-extension/CCH/LSP as future work — is in
[docs/security-limitations.md](./docs/security-limitations.md).

## Roadmap

Real-node integration, app authentication, transport security, hardened +
tamper-evident storage, Biscuit token attenuation, browser-extension integration,
and CCH/LSP policies. See [docs/production-roadmap.md](./docs/production-roadmap.md).

---

## Repository layout

```
packages/
  shared/      wire schemas, actions, reason codes, amount math
  policy/      YAML policy loader + pure decision functions
  gateway/     Fastify server, CLI, decision pipeline, storage, audit
  sdk/         @fiberguard/session — typed isomorphic client
  fiber-mock/  zero-dep JSON-RPC 2.0 mock Fiber node
apps/
  approval-ui/       Next.js approval screen + operator console (served by gateway)
  agent-demo/        :3001  spend-limited payments
  merchant-demo/     :3002  invoice creation, no payment authority
  dashboard-demo/    :3003  read-only node + channel access
examples/            policy, curl examples, demo script
docs/                architecture, policy model, API reference, security, roadmap
```

## Development

```bash
pnpm install
pnpm build     # required before test/run — workspace packages resolve via built dist/
pnpm test      # runs every package's test suite
```
