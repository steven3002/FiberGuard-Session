# Production Roadmap

FiberGuard Session is a hackathon MVP. This is the path from demo-grade to
something that could guard real funds. It is intentionally scoped — FiberGuard adds
a session/intent layer above Fiber RPC; it does not replace Fiber's own RPC
authentication.

## Near-term hardening

- **Real node integration.** Replace the placeholder RUSD `udt_type_script` with the
  real testnet/mainnet UDT script, confirm decimals and invoice encoding, and run
  the full §16 story against a live Fiber node. Point `--upstream` at the node's
  JSON-RPC endpoint. (See [security-limitations.md](./security-limitations.md).)
- **App authentication.** Replace the trusted client-supplied `origin` with signed
  app credentials (API keys or asymmetric keys). Verify the caller before any
  policy check.
- **Transport security.** TLS between app and gateway; authentication and rate
  limiting if the gateway is exposed beyond localhost.
- **Hardened storage.** Move sessions/spend/ownership to a transactional store
  (SQLite or a database), with encryption at rest for anything sensitive and proper
  file permissions.
- **Tamper-evident audit.** Hash-chain or sign audit entries so the log is
  verifiable, and support export to an external sink.

## Policy & capability model

- **Biscuit token attenuation.** Issue attenuable capability tokens so an app can
  further restrict (but never widen) its own grant, and so grants can be delegated
  offline. This is the natural evolution of the current session model.
- **Richer limits.** Rolling windows (not just UTC day), per-counterparty limits,
  velocity checks, and multi-asset budgets.
- **Policy management UX.** A UI to author and validate policies, diff changes, and
  hot-reload without restarting the gateway.

## Integrations

- **Browser-extension integration.** A wallet-style extension that owns approvals
  and origin verification, so the approval step is not a bare web page.
- **CCH and LSP policies.** Cross-chain hub and Lightning service provider flows
  are out of scope for the MVP and are roadmap items.
- **Cross-chain policies.** Extend the asset/limit model to cross-chain contexts.

## Operational

- Structured logging, metrics, and alerting on blocked-rate anomalies.
- A formal security audit before guarding meaningful value.
- Backup/restore and migration tooling for the local state stores.
