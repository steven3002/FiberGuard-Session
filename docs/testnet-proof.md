# Live Testnet Settlement — Receipts

**Short on time?** This page is the cryptographic proof that FiberGuard gated a
**real payment on the live CKB testnet** — on-chain transaction hashes you can open
in a block explorer, the FiberGuard audit log with exact reason codes, and the raw
terminal transcript. No need to run anything.

Everything below is from `pnpm demo:testnet:settle` (see
[testnet.md](./testnet.md)) running against `fnn` v0.9.0-rc7 on **CKB testnet
(Pudge)**, chain hash `0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606`.

## The two nodes

| Node | Role | CKB testnet address |
| --- | --- | --- |
| A | agent's node (behind FiberGuard) | `ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq09ctakvryj24lqx0x58whh2qz4vt2mmngyw8udv` |
| B | payee | `ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqfqhj2cr9rc3sgxawlz5yug2pedu925shsk8skaf` |

## On-chain transactions (open these in a block explorer)

Explorer: `https://pudge.explorer.nervos.org/transaction/<hash>`

| # | What | CKB L1 transaction hash |
| --- | --- | --- |
| 1 | Faucet → node A | [`0x6b3d3b1d9dd668bedd0bdbfad0da6ccbb201c3b0ef48a92cf608547ce6c93b71`](https://pudge.explorer.nervos.org/transaction/0x6b3d3b1d9dd668bedd0bdbfad0da6ccbb201c3b0ef48a92cf608547ce6c93b71) |
| 2 | **Hand-rolled A→B transfer** (single-claim: funds B's channel reserve, self-signed, no ckb-cli) | [`0x9f0d10377e422e7d63ac0671dcff3ce3a86d7533351249c3dd5d0541a331ddd3`](https://pudge.explorer.nervos.org/transaction/0x9f0d10377e422e7d63ac0671dcff3ce3a86d7533351249c3dd5d0541a331ddd3) |
| 3 | Channel funding tx (A + B cells → the channel's multisig cell) | [`0x41f5c51d6091bc3155190382678bb6167585265ffb9904b049c5f14579335af6`](https://pudge.explorer.nervos.org/transaction/0x41f5c51d6091bc3155190382678bb6167585265ffb9904b049c5f14579335af6) |
| — | (Node B's own faucet claim, used in the two-claim run) | [`0xd8fb9ef9a087144f8b6e46efff8e116cac079d9dba261cf2236f1f9a48204926`](https://pudge.explorer.nervos.org/transaction/0xd8fb9ef9a087144f8b6e46efff8e116cac079d9dba261cf2236f1f9a48204926) |

Transaction **#2 is the "single-claim flex."** It was crafted, signed, and
broadcast by `scripts/lib/ckb-transfer.py` — a pure-Python implementation of
secp256k1 recoverable ECDSA (low-s), CKB molecule serialization, and the
`secp256k1_blake160_sighash_all` signing scheme. No `ckb-cli`, no signing library.
The script asserts its locally-computed molecule tx-hash equals the hash the node
returns — it matched, so the serialization is byte-exact. Result: node B's balance
rose by exactly the transferred amount, on-chain.

## The payment channel

- **channel_id:** `0xc5eb2ede6dd7392ca7963b59968902415ca0a2b02758b350dc6a92323a171c73`
- **funding out_point:** `0x41f5c51d…335af6:0` (the L1 cell that anchors the channel)
- **capacity:** 500 CKB, one-way A→B, private
- After several settlements the off-chain balances stand at **A ≈ 398 / B ≈ 3 CKB** —
  each `pay_invoice` moved 1 CKB from A to B **off-chain, in ~4 seconds**, without a
  new L1 transaction. That is the whole point of a state channel.

> Note: **Fiber payment hashes are off-chain** (HTLC payment identifiers), not L1
> transactions — e.g. the first settled payment
> `0x68814f852e8f583de75d06a14bc7f4eaa369473e9d4cf70db6a4d782e3c51e48` (status
> `Success`). They settle over the channel above; only channel *open* and *close*
> touch L1.

## FiberGuard audit log (raw `/audit`, one run)

Allowed settlement next to the blocked RPC actions — reason codes verbatim:

```json
{
  "events": [
    { "event": "session_requested", "app_id": "agent-demo", "decision": "allowed",
      "reason": "APPROVAL_REQUIRED", "details": { "session_request_id": "sr_Rm2YJ3zyTucJpQXJ" } },
    { "event": "session_approved",  "app_id": "agent-demo", "decision": "allowed",
      "reason": "WITHIN_POLICY", "details": { "approval_type": "session" } },
    { "event": "intent_allowed",    "app_id": "agent-demo", "action": "payment.pay_invoice",
      "asset": "CKB", "requested_amount": "1", "decision": "allowed", "reason": "WITHIN_POLICY" },
    { "event": "intent_blocked",    "app_id": "agent-demo", "action": "channel.open",
      "decision": "blocked", "reason": "ACTION_EXPLICITLY_DENIED" },
    { "event": "intent_blocked",    "app_id": "agent-demo", "action": "payment.pay_invoice",
      "asset": "CKB", "requested_amount": "500", "decision": "blocked",
      "reason": "AMOUNT_EXCEEDS_SESSION_LIMIT",
      "details": { "requested_amount": "500", "max_amount_per_payment": "100", "asset": "CKB" } },
    { "event": "intent_allowed",    "app_id": "agent-demo", "action": "payment.read_own",
      "decision": "allowed", "reason": "WITHIN_POLICY" }
  ]
}
```

The story in one frame: the agent's **in-limit CKB payment settled on the real
network**, while the **channel-open** and the **over-limit (500 > 100 CKB)** attempts
were **blocked before ever reaching the node**.

## Terminal transcript (`pnpm demo:testnet:settle`)

```
[SETUP] FiberGuard × real CKB testnet — scripted settlement
  ✓ node A already running (:8227)
  ✓ node B already running (:8237)
[FiberGuard] Checking on-chain balances (real CKB testnet)…
  ✓ node A funded: 99349 CKB (on-chain)
  ✓ node B funded: 100050 CKB (on-chain)
[Fiber] Reusing existing state channel 0xc5eb2ede6dd7392c… (A local 399 CKB) — no L1 wait needed
[Fiber] Node B (payee) issues a 1 CKB invoice…
  ✓ invoice: fibt1000000001pkeymvj3p67gfw0pmm6vkhulnq…  (payment_hash 0x486bd3ef8d2e…)
[FiberGuard] Agent requests a CKB payment session (approval-gated)…
  ✓ session request: sr_Rm2YJ3zyTucJpQXJ (pending approval)
[FiberGuard] Operator approves the session…
  ✓ session approved: sess_hFBOmHFqeKozyH86t19fNg
[FiberGuard] Agent pays B's invoice THROUGH FiberGuard (policy-checked → send_payment)…
  gateway decision: allowed | status: forwarded | reason: WITHIN_POLICY
[Fiber] Settling off-chain over the state channel…
  payment status: Inflight (2s) → Success (4s)
  ✓ PAYMENT SETTLED — status Success
  ✓ off-chain balances moved:  agent(A) 399 → 398 CKB   |   payee(B) 2 → 3 CKB
  ✓ payee invoice status: Paid
[FiberGuard] Same session now tries actions the policy forbids…
  ⛔ open a channel → BLOCKED ACTION_EXPLICITLY_DENIED (never reaches the node)
  ⛔ pay 500 CKB (over the 100 limit) → BLOCKED AMOUNT_EXCEEDS_SESSION_LIMIT (never reaches the node)
  ✓ agent reads its OWN settled payment (payment.read_own) → Success
[FiberGuard] FiberGuard audit log — the whole story, side by side:
  ALLOW  session_requested                      APPROVAL_REQUIRED
  ALLOW  session_approved                      WITHIN_POLICY
  ALLOW  intent_allowed   payment.pay_invoice   WITHIN_POLICY
  BLOCK  intent_blocked   channel.open          ACTION_EXPLICITLY_DENIED
  BLOCK  intent_blocked   payment.pay_invoice   AMOUNT_EXCEEDS_SESSION_LIMIT
  ALLOW  intent_allowed   payment.read_own      WITHIN_POLICY
✔ LIVE SETTLEMENT COMPLETE.
```

## Verify it yourself

- **On-chain:** open transactions #1–#3 above in the explorer — real cells, real
  capacities, on CKB testnet.
- **Reproduce:** `pnpm demo:testnet:settle` (one faucet claim to node A; the script
  funds node B over L1 itself and settles). See [testnet.md](./testnet.md).
- **Honest scope:** demo-grade keys, testnet only — see
  [security-limitations.md](./security-limitations.md).
