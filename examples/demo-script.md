# Demo Script

This is the exact §16 story, as a runnable walkthrough. It uses the three demo apps
and the approval UI in a browser. For the pure-API version (no browser), see
[curl-examples.md](./curl-examples.md).

## 0. Start everything

From the repo root:

```bash
pnpm install
pnpm demo
```

`pnpm demo` builds the workspace, then starts (and cleans up on Ctrl-C):

| Service | URL |
| --- | --- |
| Mock Fiber node | http://127.0.0.1:8227 |
| FiberGuard gateway + approval UI | http://localhost:8787 |
| Agent demo | http://localhost:3001 |
| Merchant demo | http://localhost:3002 |
| Read-only dashboard demo | http://localhost:3003 |

> To run against a **real** Fiber node instead of the mock, start the gateway
> yourself with `--upstream <node-rpc-url>` and a policy whose RUSD
> `udt_type_script` is the real UDT script. See
> [../docs/security-limitations.md](../docs/security-limitations.md).

## The story (§16 steps 1–24)

1. **Start a local Fiber node.** — `pnpm demo` starts the bundled mock on :8227.
2. **Start FiberGuard Session with `fiberguard.yml`.** — the gateway comes up on
   :8787 with the approval UI.
3. **Open the Agent Demo** at http://localhost:3001.
4. **Agent requests permission** to pay RUSD invoices up to 1 RUSD. Click
   **Request Payment Session**. The app calls `guard.requestSession(...)` for
   `payment.pay_invoice` (RUSD, max 1/payment, daily 5, expires 10m) +
   `payment.read_own`.
5. **Approval UI opens.** The agent surfaces the `approval_url`; open it (a new tab
   to the gateway's approval screen). It shows the app, origin, requested
   permissions, and the actions blocked by policy.
6. **User approves the session.** Click **Approve session**. The session becomes
   active; the agent's status badge flips to *active* (it was polling
   `session.waitForApproval()`).
7. **Agent pays a 0.5 RUSD invoice successfully.** Paste the merchant's invoice (or
   use the default demo invoice) and click **Pay 0.5 RUSD Invoice**. Green result
   panel with a `payment_hash`.
8. **Agent tries to pay a 100 RUSD invoice.** Click **Try Pay 100 RUSD**.
9. **FiberGuard blocks it with `AMOUNT_EXCEEDS_SESSION_LIMIT`.** Red result panel.
10. **Agent tries to open a channel.** Click **Try Open Channel**.
11. **FiberGuard blocks it with `ACTION_EXPLICITLY_DENIED`.** Red result panel.
12. **Open the Merchant Demo** at http://localhost:3002. Click **Start session** —
    it is auto-approved (no approval screen); the badge reads *active (auto-approved)*.
13. **Merchant creates a 10 RUSD invoice successfully.** Click **Create 10 RUSD
    Invoice**. The returned `invoice_address` appears in a copyable field — copy it
    into the Agent demo's invoice input for step 7 if you like.
14. **Merchant tries to send a payment.** Click **Try Send Payment**.
15. **FiberGuard blocks it with `ACTION_NOT_ALLOWED`.** Red result panel (the
    merchant was never granted `payment.pay_invoice`).
16. **Open the Dashboard Demo** at http://localhost:3003. Click **Start session** —
    auto-approved, read-only.
17. **Dashboard reads node info and channel summary.** Click **Read Node Info**
    (safe summary only) and **Read Channel Summary** → `{ total: 3, open: 2,
    closed: 1 }`.
18. **Dashboard tries to close a channel.** Click **Try Close Channel**.
19. **FiberGuard blocks it** with `ACTION_EXPLICITLY_DENIED`. Red result panel.
20. **Revoke the Agent Demo session.** Open the operator console at
    http://localhost:8787/ , find the agent session in the active list, and click
    **Revoke**.
21. **Agent tries to pay again.** Back in the Agent demo, click **Pay 0.5 RUSD
    Invoice**.
22. **FiberGuard blocks it with `SESSION_REVOKED`.** Red result panel.
23. **Open the audit log.** Each demo has a **Show Audit** panel; the operator
    console shows the full log. Or `curl -s http://localhost:8787/audit | jq`.
24. **Show all allowed and blocked decisions.** The audit trail contains every
    step: session requested/approved, the allowed 0.5 payment and read, the blocked
    100, the blocked channel.open, the merchant auto-approve + invoice + blocked
    pay, the dashboard reads + blocked close, the revoke, and the final blocked pay
    — 15 events in total.

**The key message:** apps used real Fiber capabilities (payments, invoices, reads)
without ever holding broad node permissions. Every unsafe or over-limit action was
blocked before it reached the node, and all of it is auditable.

## Verifying without a browser

The identical decisions are reproduced by two automated paths:

- `examples/curl-examples.md` — the same 24-step story over `curl`.
- `pnpm --filter @fiberguard/session test` — the SDK integration tests drive the
  same intents against a live gateway + mock and assert every allowed/blocked
  outcome.
