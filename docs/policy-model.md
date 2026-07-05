# Policy Model

The policy is a single YAML file (`--policy`). It declares the **assets** the
gateway understands and, per **app**, the origins it may call from, the actions it
may take (with limits), and the actions explicitly denied. Anything not allowed is
blocked by default.

## Assets

```yaml
assets:
  RUSD:
    decimals: 8
    udt_type_script:            # the UDT this asset maps to on-chain
      code_hash: "0x…"
      hash_type: type
      args: "0x"
  CKB:
    decimals: 8
    native: true               # native CKB, no UDT script
```

`decimals` drives the decimal→base-unit conversion at the RPC boundary
(`"0.5"` RUSD at 8 decimals → `50000000` → `0x2faf080`). For a real node the RUSD
`udt_type_script` must be the actual testnet/mainnet script — the bundled example
uses an all-zero placeholder that only works against the mock. See
[security-limitations.md](./security-limitations.md).

## Apps

```yaml
apps:
  agent-demo:
    name: "Agent Demo"
    origins:
      - "http://localhost:3001"      # CORS + per-intent origin check
    allow:
      - action: "payment.pay_invoice"
        assets: ["RUSD"]             # asset allow-list for this action
        max_amount_per_payment: "1"  # per-payment cap (decimal string)
        daily_limit: "5"             # per-app/action/asset/UTC-day cap
        require_approval: true       # must be approved in the UI
        expires_in: "10m"            # session TTL
      - action: "payment.read_own"   # read-only, no limits
    deny:
      - action: "channel.open"       # refused even if a session requests it
      - action: "channel.close"
      - action: "peer.connect"
      - action: "payments.read_all"
```

Supported policy fields: app identity (`name`), allowed `origins`, allowed
`actions`, denied `actions`, allowed `assets` per action, `max_amount_per_payment`,
`max_amount_per_invoice`, `daily_limit`, `require_approval`, and `expires_in`.
Revocation is a runtime operation, not a policy field.

## Actions

Nine actions exist. Five are fully implemented (forwarded to Fiber when allowed);
four are "restricted" — they exist so the gateway can demonstrably block them
before they reach the node.

| Action | Implemented | Fiber RPC when allowed |
| --- | --- | --- |
| `payment.pay_invoice` | ✅ | `send_payment` |
| `invoice.create` | ✅ | `new_invoice` |
| `payment.read_own` | ✅ | `get_payment` (ownership-checked) |
| `node.read` | ✅ | `node_info` (safe summary) |
| `channels.read_summary` | ✅ | `list_channels` → counts |
| `channel.open` | ⛔ restricted | — always blocked |
| `channel.close` | ⛔ restricted | — always blocked |
| `peer.connect` | ⛔ restricted | — always blocked |
| `payments.read_all` | ⛔ restricted | — always blocked |

> Naming note: the canonical action is `payment.read_own` (singular `payment`).
> The product doc's §8 dashboard example wrote `payments.read_own`; that typo is
> standardized to `payment.read_own` across the whole stack.

## The ordered decision checks

Every intent runs the same ordered checks (`evaluateIntent`, a pure function in
`@fiberguard/policy`). The **first** failing check decides the block and its
reason code. Order matters: a denied action blocks before amount is ever
considered, and nothing reaches the Fiber node unless every check passes.

| # | Check | Reason code on failure |
| --- | --- | --- |
| 1 | App exists in policy | `APP_NOT_FOUND` |
| 2 | Origin is in the app's `origins` | `ORIGIN_NOT_ALLOWED` |
| 3 | Session exists | `SESSION_NOT_FOUND` |
| 4 | Session is approved (not still pending) | `SESSION_PENDING_APPROVAL` |
| 5 | Session not expired | `SESSION_EXPIRED` |
| 6 | Session not revoked | `SESSION_REVOKED` |
| 7 | Action is not in `deny` | `ACTION_EXPLICITLY_DENIED` |
| 8 | Action is in `allow` (granted on the session) | `ACTION_NOT_ALLOWED` |
| 9 | Asset is allowed for the action | `ASSET_NOT_ALLOWED` |
| 10 | Amount ≤ per-payment / per-invoice cap | `AMOUNT_EXCEEDS_SESSION_LIMIT` |
| 11 | App still under its daily limit | `AMOUNT_EXCEEDS_DAILY_LIMIT` |
| 12 | Approval requirement satisfied | `APPROVAL_REQUIRED` |
| 13 | (reads) payment owned by this session | `PAYMENT_NOT_OWNED_BY_SESSION` |
| — | Malformed request body | `INVALID_REQUEST` |
| — | Allowed, but Fiber node errored | `UPSTREAM_FIBER_ERROR` |
| ✓ | All checks pass | `WITHIN_POLICY` |

`deny` is checked **before** `allow` (step 7 before 8): an explicitly denied
action yields `ACTION_EXPLICITLY_DENIED`, while an action that is simply never
granted yields `ACTION_NOT_ALLOWED`. That is why the example merchant policy does
**not** list `payment.pay_invoice` under `deny` — leaving it ungranted makes an
attempt fail with `ACTION_NOT_ALLOWED` (matching product doc §16 step 15).

## Approval semantics

- `require_approval: false` (or omitted) → the session is auto-approved on request
  and returns a `session_id` immediately.
- `require_approval: true` → the request returns `pending_approval` + an
  `approval_url`. The owner approves in the UI:
  - **Approve session** → the session is usable until `expires_at`.
  - **Approve once** → a one-shot session, consumed by the first allowed intent.
  - **Deny** → the request is rejected; no session is created.

## Spend limits & ownership

- **Daily limit** is tracked per `appId :: action :: asset :: UTC-day` in the spend
  ledger and only incremented **after** a successful upstream forward, so a blocked
  or failed intent never consumes budget.
- **`payment.read_own`** is enforced by an ownership index mapping each
  `payment_hash` to the session that created or paid it (first-writer-wins). Reading
  a hash your session doesn't own blocks with `PAYMENT_NOT_OWNED_BY_SESSION`.
