# API Reference

Base URL: `http://localhost:8787` (the gateway's `--port`). All request and
response bodies are JSON. Every payload below is copied from a live run against the
bundled mock node; see [../examples/curl-examples.md](../examples/curl-examples.md)
for runnable `curl` commands.

Blocked decisions return HTTP `403` (or `400` for malformed input, `404` for a
missing session, `409` for an already-resolved request, `502` for an upstream Fiber
error) with a uniform envelope:

```json
{ "status": "blocked", "decision": "blocked", "reason": "<REASON_CODE>", "details": { } }
```

See [policy-model.md](./policy-model.md) for the full list of reason codes.

---

## Sessions

### POST /session/request

Open a session. Auto-approved apps get a `session_id`; approval-gated apps get a
`pending_approval` status and an `approval_url`.

Request:
```json
{
  "app_id": "agent-demo",
  "origin": "http://localhost:3001",
  "requested_permissions": [
    { "action": "payment.pay_invoice", "asset": "RUSD",
      "max_amount_per_payment": "1", "daily_limit": "5", "expires_in": "10m" },
    { "action": "payment.read_own" }
  ]
}
```

Response (approval required):
```json
{
  "status": "pending_approval",
  "session_request_id": "sr_Tu7w_1zP4yqdr2zA",
  "approval_url": "http://localhost:8787/approve/sr_Tu7w_1zP4yqdr2zA"
}
```

Response (auto-approved):
```json
{ "status": "approved", "session_id": "sess_iTRz…", "expires_at": "2026-07-06T20:18:55.821Z" }
```

### POST /session/approve

Request: `{ "session_request_id": "sr_…", "approval_type": "session" }`
(`approval_type` is `"session"` or `"once"`).

Response:
```json
{ "status": "approved", "session_id": "sess_Xs4la…", "expires_at": "2026-07-05T20:28:55.688Z" }
```

### POST /session/deny

Request: `{ "session_request_id": "sr_…", "reason": "User denied request" }`
(reason optional). Response: `{ "status": "denied" }`.

### POST /session/revoke

Request: `{ "session_id": "sess_…" }`. Idempotent.

Response: `{ "status": "revoked", "session_id": "sess_…" }`.

### GET /session/current?session_id=sess_…

Returns the session's status, expiry, and granted permissions.

### Operator / approval-UI endpoints

- `GET /session/pending` — pending session requests (for the approval screen).
- `GET /session/active` — active sessions, newest first (for the revoke panel).
- `GET /session/request/:session_request_id` — the full approval view for one
  request (app name, origin, granted permissions, denied actions).

---

## Intents

All intent bodies carry `session_id`, `app_id`, and `origin`; the gateway
cross-checks them against the stored session and policy.

### POST /intent/pay-invoice

Request:
```json
{
  "session_id": "sess_…", "app_id": "agent-demo", "origin": "http://localhost:3001",
  "invoice": "fibt1…", "asset": "RUSD", "amount": "0.5", "reason": "Pay for API request"
}
```

Allowed:
```json
{
  "status": "forwarded", "decision": "allowed",
  "payment_hash": "0x1fbc…033e",
  "fiber_result": { "payment_hash": "0x1fbc…033e", "status": "Success", "amount": "0x2faf080", "fee": "0x0", "…": "…" }
}
```

Blocked (over the per-payment cap):
```json
{
  "status": "blocked", "decision": "blocked",
  "reason": "AMOUNT_EXCEEDS_SESSION_LIMIT",
  "details": { "requested_amount": "100", "max_amount_per_payment": "1", "asset": "RUSD" }
}
```

### POST /intent/create-invoice

Request:
```json
{
  "session_id": "sess_…", "app_id": "merchant-demo", "origin": "http://localhost:3002",
  "asset": "RUSD", "amount": "10", "description": "Order #1234"
}
```

Allowed:
```json
{
  "status": "forwarded", "decision": "allowed",
  "invoice": "fibt19613823ce…2823a",
  "fiber_result": { "invoice_address": "fibt1961…2823a", "invoice": { "currency": "Fibt", "amount": "0x3b9aca00", "status": "Open", "…": "…" } }
}
```

### POST /intent/action

For restricted actions only (`channel.open`, `channel.close`, `peer.connect`,
`payments.read_all`). Always terminates as a block — never forwarded.

Request: `{ "session_id": "sess_…", "app_id": "agent-demo", "origin": "http://localhost:3001", "action": "channel.open" }`

Blocked:
```json
{ "status": "blocked", "decision": "blocked", "reason": "ACTION_EXPLICITLY_DENIED", "details": { "action": "channel.open" } }
```

---

## Reads

### GET /payments/:payment_hash?session_id=sess_…

Enforces `payment.read_own` via the ownership index.

```json
{ "status": "allowed", "payment": { "payment_hash": "0x1fbc…033e", "state": "Success" } }
```

### GET /node/info?session_id=sess_…

Returns a **safe summary** of `node_info` — version, node name, pubkey, chain hash,
channel/peer counts. Sensitive fields (e.g. `udt_cfg_infos`) are never exposed.

```json
{
  "status": "allowed",
  "node": { "version": "0.1.0-fiberguard-mock", "node_name": "fiberguard-mock-node",
            "pubkey": "0xf5f0…d21e", "chain_hash": "0xcc48…7ffb",
            "channel_count": "0x2", "pending_channel_count": "0x0", "peers_count": "0x1" }
}
```

### GET /channels/summary?session_id=sess_…

Returns counts only — never full channel details.

```json
{ "status": "allowed", "summary": { "total_channels": 3, "open_channels": 2, "closed_channels": 1 } }
```

---

## Audit

### GET /audit?app_id=<id>&limit=<n>

Newest-first list of decisions. Both query params are optional.

```json
{
  "events": [
    { "event": "intent_blocked", "app_id": "agent-demo", "origin": "http://localhost:3001",
      "session_id": "sess_…", "action": "payment.pay_invoice", "asset": "RUSD",
      "requested_amount": "100", "decision": "blocked",
      "reason": "AMOUNT_EXCEEDS_SESSION_LIMIT",
      "details": { "requested_amount": "100", "max_amount_per_payment": "1", "asset": "RUSD" },
      "timestamp": "2026-07-05T20:18:55.785Z" }
  ]
}
```

Event types: `session_requested`, `session_approved`, `session_denied`,
`session_revoked`, `intent_allowed`, `intent_blocked`. Every event carries
`decision`, `reason`, and `timestamp`; intents also carry `action`, `app_id`,
`origin`, and `session_id`.

---

## Health

### GET /healthz

`{ "status": "ok", "service": "fiberguard-gateway", "apps": 3 }`
