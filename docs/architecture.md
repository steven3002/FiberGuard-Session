# Architecture

FiberGuard Session is a local permission gateway that sits between external apps
and a Fiber Network node. Apps never hold raw Fiber JSON-RPC authority; they hold
scoped, revocable, spend-limited **sessions** and call high-level **payment
intents**. The gateway decides, then forwards only what policy allows.

```
   Browser app (agent / merchant / dashboard, its own origin :300x)
        │  @fiberguard/session SDK  (typed intents, cross-origin fetch)
        ▼
   ┌─────────────────────────── FiberGuard Gateway (:8787) ───────────────────────────┐
   │                                                                                   │
   │   HTTP routes          Decision pipeline (ordered checks)        State (local)    │
   │   ───────────          ─────────────────────────────────        ─────────────    │
   │   /session/*           1  app known?          9  daily limit?    sessions.json    │
   │   /intent/*      ──►    2  origin allowed?     10 approval met?   spend.json       │
   │   /payments/:h         3  session exists?     11 forward|block?  ownership.json    │
   │   /channels/summary    …  active / expired /  12 audit           audit.jsonl       │
   │   /node/info              revoked / allowed /                     policy (YAML)     │
   │   /audit                  asset / amount …                                         │
   │                                                                                   │
   │   Approval UI  (Next.js static export served at / and /approve/:id)                │
   └───────────────────────────────────┬───────────────────────────────────────────────┘
                                        │  Fiber JSON-RPC 2.0 (single POST, params:[{…}])
                                        ▼
                        Fiber node  (real, or the bundled mock on :8227)
```

## Components

| Package | Role |
| --- | --- |
| `@fiberguard/shared` | Wire schemas (zod), the nine actions, the sixteen reason codes, fixed-point BigInt amount math, duration parsing. No I/O. |
| `@fiberguard/policy` | YAML policy loader + structural invariants, and two **pure** deciders: `evaluateSessionRequest` and `evaluateIntent` (the ordered checks). No I/O. |
| `@fiberguard/gateway` | Fastify server, CLI (`fiberguard`), the decision pipeline that orchestrates the pure deciders + upstream forwarding, local JSON/JSONL storage, and the audit writer. Serves the approval UI. |
| `@fiberguard/session` (SDK) | Isomorphic typed client. Turns intents into gateway calls; classifies blocked decisions as typed results (not thrown). |
| `@fiberguard/fiber-mock` | Zero-dependency `node:http` JSON-RPC 2.0 stand-in for a Fiber node (dev + tests). |
| `apps/approval-ui` | Next.js static export: the §14 approval screen + an operator console (pending / active / audit). Served by the gateway. |
| `apps/{agent,merchant,dashboard}-demo` | Three Next.js apps, each on its own origin, using only the SDK. |

## Request lifecycle

1. **Session request** — the app calls `POST /session/request`. The policy decides:
   auto-approve (no `require_approval`) → returns a `session_id`; otherwise
   `pending_approval` with an `approval_url`.
2. **Approval** — the node owner opens the approval URL and clicks Approve
   (session/once) or Deny. Approval mints the session.
3. **Intent** — the app calls an intent (`/intent/pay-invoice`,
   `/intent/create-invoice`, reads). The gateway runs the ordered checks. Only on
   an allowed decision does it call the Fiber node and then advance spend/ownership
   state.
4. **Audit** — exactly one audit event is written per decision (allowed or
   blocked), carrying the reason code, app, origin, session, and timestamp.
5. **Revocation / expiry** — the owner can revoke any time; sessions also lapse at
   their `expires_at`. Subsequent intents block with `SESSION_REVOKED` /
   `SESSION_EXPIRED`.

## The decision pipeline

The ordered checks (product doc §3, §11.6) live as a pure function in
`@fiberguard/policy` (`evaluateIntent`). It never performs I/O — it takes the
policy, the session, and the intent, and returns an allow/block decision with a
reason code. The gateway pipeline (`packages/gateway/src/core/decision/pipeline.ts`)
wraps it: it loads the session, calls `evaluateIntent`, and **only if allowed**
forwards to the Fiber node and then mutates the spend ledger and ownership index.
This ordering guarantees a blocked intent never reaches the node and never moves
money-tracking state. See [policy-model.md](./policy-model.md) for the exact order.

## State & storage

All state is local, under the gateway's `--data` directory (default `.fiberguard`):

- `sessions.json` — session requests and sessions (atomic writes, serialized mutations).
- `spend.json` — the spend ledger, keyed `appId::action::asset::utcDate`, for daily limits.
- `ownership.json` — `payment_hash → session` map, enforcing `payment.read_own`.
- `audit.jsonl` — append-only audit log (one JSON object per line).

This is deliberately simple hackathon-grade storage. See
[security-limitations.md](./security-limitations.md).

## Fiber wire mapping

The gateway is the only component that speaks Fiber JSON-RPC. It uses a single
POST endpoint, `params` as a one-element array wrapping the argument object, and
u128/u64 amounts encoded as `0x`-prefixed hex strings (confirmed against Fiber's
own bruno e2e payloads). Decimal amounts from apps (`"0.5"`) are converted to
base units at the RPC boundary only (`toBaseUnits`, using each asset's `decimals`).
Intent → RPC method mapping:

| Intent | Fiber RPC |
| --- | --- |
| `payment.pay_invoice` | `send_payment` |
| `invoice.create` | `new_invoice` |
| `payment.read_own` | `get_payment` |
| `node.read` | `node_info` (safe summary fields only) |
| `channels.read_summary` | `list_channels` → `{ total, open, closed }` |

Restricted actions (`channel.open`, `channel.close`, `peer.connect`,
`payments.read_all`) have **no** forwarding path — they always terminate at the
pipeline as a block.
