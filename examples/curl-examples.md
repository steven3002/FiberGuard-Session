# curl Examples

Every request/response below was captured from a live run of the gateway against
the bundled mock node. Build once, then start the two services (each in its own
shell):

```bash
pnpm build            # build packages + the approval UI export
pnpm mock             # mock Fiber node on :8227
pnpm gateway          # gateway + approval UI on :8787 (upstream = the mock)
```

Then, in another shell:

```bash
GW=http://127.0.0.1:8787
```

The examples chain real ids with shell variables + `jq`, so you can paste them in
order and they will work end to end.

---

## 1. Agent requests a spend-limited RUSD session (approval required)

```bash
SRID=$(curl -s -X POST "$GW/session/request" \
  -H 'content-type: application/json' \
  -H 'origin: http://localhost:3001' \
  -d '{
    "app_id": "agent-demo",
    "origin": "http://localhost:3001",
    "requested_permissions": [
      { "action": "payment.pay_invoice", "asset": "RUSD",
        "max_amount_per_payment": "1", "daily_limit": "5", "expires_in": "10m" },
      { "action": "payment.read_own" }
    ]
  }' | jq -r '.session_request_id')
echo "$SRID"
```

Response:
```json
{
  "status": "pending_approval",
  "session_request_id": "sr_Tu7w_1zP4yqdr2zA",
  "approval_url": "http://localhost:8787/approve/sr_Tu7w_1zP4yqdr2zA"
}
```

## 2. Owner approves the session

In the demo the owner clicks **Approve session** at the `approval_url`. The
equivalent API call:

```bash
SESS=$(curl -s -X POST "$GW/session/approve" \
  -H 'content-type: application/json' \
  -d "{ \"session_request_id\": \"$SRID\", \"approval_type\": \"session\" }" \
  | jq -r '.session_id')
echo "$SESS"
```

Response:
```json
{ "status": "approved", "session_id": "sess_Xs4laQ_QIBFXRU8GqLYmSw", "expires_at": "2026-07-05T20:28:55.688Z" }
```

## 3. Pay a 0.5 RUSD invoice — ALLOWED

```bash
PHASH=$(curl -s -X POST "$GW/intent/pay-invoice" \
  -H 'content-type: application/json' \
  -H 'origin: http://localhost:3001' \
  -d "{
    \"session_id\": \"$SESS\", \"app_id\": \"agent-demo\", \"origin\": \"http://localhost:3001\",
    \"invoice\": \"fibt1qderdemoinvoice0p5rusd\", \"asset\": \"RUSD\", \"amount\": \"0.5\",
    \"reason\": \"Pay for API request\"
  }" | tee /dev/stderr | jq -r '.payment_hash')
```

Response:
```json
{
  "status": "forwarded", "decision": "allowed",
  "payment_hash": "0x1fbcadc6b328f85d8dc3381e4f703b85559516c675f67c159cbbbc9134f7033e",
  "fiber_result": { "status": "Success", "amount": "0x2faf080", "fee": "0x0", "…": "…" }
}
```

## 4. Read your own payment — ALLOWED (`payment.read_own`)

```bash
curl -s "$GW/payments/$PHASH?session_id=$SESS" -H 'origin: http://localhost:3001' | jq
```

```json
{ "status": "allowed", "payment": { "payment_hash": "0x1fbc…033e", "state": "Success" } }
```

## 5. Try to pay 100 RUSD — BLOCKED `AMOUNT_EXCEEDS_SESSION_LIMIT` (HTTP 403)

```bash
curl -s -X POST "$GW/intent/pay-invoice" \
  -H 'content-type: application/json' -H 'origin: http://localhost:3001' \
  -d "{ \"session_id\": \"$SESS\", \"app_id\": \"agent-demo\", \"origin\": \"http://localhost:3001\",
        \"invoice\": \"fibt1qderdemoinvoice100rusd\", \"asset\": \"RUSD\", \"amount\": \"100\", \"reason\": \"overspend\" }" | jq
```

```json
{ "status": "blocked", "decision": "blocked", "reason": "AMOUNT_EXCEEDS_SESSION_LIMIT",
  "details": { "requested_amount": "100", "max_amount_per_payment": "1", "asset": "RUSD" } }
```

## 6. Try to open a channel — BLOCKED `ACTION_EXPLICITLY_DENIED` (HTTP 403)

```bash
curl -s -X POST "$GW/intent/action" \
  -H 'content-type: application/json' -H 'origin: http://localhost:3001' \
  -d "{ \"session_id\": \"$SESS\", \"app_id\": \"agent-demo\", \"origin\": \"http://localhost:3001\", \"action\": \"channel.open\" }" | jq
```

```json
{ "status": "blocked", "decision": "blocked", "reason": "ACTION_EXPLICITLY_DENIED", "details": { "action": "channel.open" } }
```

## 7. Merchant opens an auto-approved session and creates a 10 RUSD invoice

```bash
MSESS=$(curl -s -X POST "$GW/session/request" \
  -H 'content-type: application/json' -H 'origin: http://localhost:3002' \
  -d '{ "app_id": "merchant-demo", "origin": "http://localhost:3002",
        "requested_permissions": [ { "action": "invoice.create", "asset": "RUSD", "max_amount_per_invoice": "100" }, { "action": "payment.read_own" } ] }' \
  | jq -r '.session_id')

curl -s -X POST "$GW/intent/create-invoice" \
  -H 'content-type: application/json' -H 'origin: http://localhost:3002' \
  -d "{ \"session_id\": \"$MSESS\", \"app_id\": \"merchant-demo\", \"origin\": \"http://localhost:3002\",
        \"asset\": \"RUSD\", \"amount\": \"10\", \"description\": \"Order #1234\" }" | jq
```

```json
{ "status": "forwarded", "decision": "allowed",
  "invoice": "fibt19613823ce6201d7e2e36d1ece91741fcf5da7e8fc8e2823a",
  "fiber_result": { "invoice_address": "fibt1961…2823a", "invoice": { "currency": "Fibt", "amount": "0x3b9aca00", "status": "Open", "…": "…" } } }
```

## 8. Merchant tries to pay — BLOCKED `ACTION_NOT_ALLOWED` (HTTP 403)

```bash
curl -s -X POST "$GW/intent/pay-invoice" \
  -H 'content-type: application/json' -H 'origin: http://localhost:3002' \
  -d "{ \"session_id\": \"$MSESS\", \"app_id\": \"merchant-demo\", \"origin\": \"http://localhost:3002\",
        \"invoice\": \"fibt1qderdemoinvoice0p5rusd\", \"asset\": \"RUSD\", \"amount\": \"0.5\", \"reason\": \"nope\" }" | jq
```

```json
{ "status": "blocked", "decision": "blocked", "reason": "ACTION_NOT_ALLOWED", "details": { "action": "payment.pay_invoice" } }
```

> Note: the merchant policy does **not** list `payment.pay_invoice` under `deny`,
> so the block is `ACTION_NOT_ALLOWED` (never granted), not
> `ACTION_EXPLICITLY_DENIED`.

## 9. Dashboard reads node info and channel summary — ALLOWED

```bash
DSESS=$(curl -s -X POST "$GW/session/request" \
  -H 'content-type: application/json' -H 'origin: http://localhost:3003' \
  -d '{ "app_id": "dashboard-demo", "origin": "http://localhost:3003",
        "requested_permissions": [ { "action": "node.read" }, { "action": "channels.read_summary" }, { "action": "payment.read_own" } ] }' \
  | jq -r '.session_id')

curl -s "$GW/node/info?session_id=$DSESS"        -H 'origin: http://localhost:3003' | jq '.node | {version, node_name, channel_count, peers_count}'
curl -s "$GW/channels/summary?session_id=$DSESS" -H 'origin: http://localhost:3003' | jq
```

```json
{ "status": "allowed", "summary": { "total_channels": 3, "open_channels": 2, "closed_channels": 1 } }
```

## 10. Dashboard tries to close a channel — BLOCKED `ACTION_EXPLICITLY_DENIED` (HTTP 403)

```bash
curl -s -X POST "$GW/intent/action" \
  -H 'content-type: application/json' -H 'origin: http://localhost:3003' \
  -d "{ \"session_id\": \"$DSESS\", \"app_id\": \"dashboard-demo\", \"origin\": \"http://localhost:3003\", \"action\": \"channel.close\" }" | jq
```

```json
{ "status": "blocked", "decision": "blocked", "reason": "ACTION_EXPLICITLY_DENIED", "details": { "action": "channel.close" } }
```

## 11. Revoke the agent session, then try to pay — BLOCKED `SESSION_REVOKED` (HTTP 403)

```bash
curl -s -X POST "$GW/session/revoke" -H 'content-type: application/json' \
  -d "{ \"session_id\": \"$SESS\" }" | jq

curl -s -X POST "$GW/intent/pay-invoice" \
  -H 'content-type: application/json' -H 'origin: http://localhost:3001' \
  -d "{ \"session_id\": \"$SESS\", \"app_id\": \"agent-demo\", \"origin\": \"http://localhost:3001\",
        \"invoice\": \"fibt1qderdemoinvoice0p5rusd\", \"asset\": \"RUSD\", \"amount\": \"0.5\", \"reason\": \"after revoke\" }" | jq
```

```json
{ "status": "revoked", "session_id": "sess_Xs4laQ_QIBFXRU8GqLYmSw" }
{ "status": "blocked", "decision": "blocked", "reason": "SESSION_REVOKED", "details": { "session_id": "sess_Xs4la…" } }
```

## 12. Read the audit log

```bash
curl -s "$GW/audit" | jq '.events | length'                 # all events, newest first
curl -s "$GW/audit?app_id=agent-demo&limit=5" | jq          # filtered
```

Each event carries `event`, `decision`, `reason`, `timestamp`, and (for intents)
`action`, `app_id`, `origin`, `session_id`. A full run of the story above produces
15 events — the complete allowed/blocked trail for all three apps.
