# Security Limitations

FiberGuard Session is a hackathon-grade local permission gateway.

It demonstrates app-level payment sessions, spend limits, approval prompts,
revocation, and audit logs for Fiber RPC integrations.

It is not production-audited and should not be used to secure large amounts of
funds without further review.

## Known limitations

- Policy storage is local and simple.
- Session storage is local and not hardened.
- Origin checks are suitable for local demos but need production hardening.
- No formal security audit has been completed.
- Advanced Biscuit token attenuation is future work unless implemented during the
  hackathon.
- Browser-extension integration is future work.
- CCH and LSP policies are future work.

This honesty is important.

## Additional current-state honesty

- **The demo runs against a bundled mock Fiber node, not a live node.** The mock
  (`@fiberguard/fiber-mock`) speaks the same JSON-RPC 2.0 shape as Fiber (single
  POST endpoint, `params:[{…}]`, `0x`-hex u128/u64 amounts, verified against
  Fiber's own e2e payloads), but it does not settle real value. The example policy
  ships a **placeholder** all-zero RUSD `udt_type_script`; before pointing
  `--upstream` at a real node you must replace it with the real UDT type script and
  confirm the asset's decimals and the testnet invoice encoding.
- **The gateway trusts the `origin` field in request bodies.** A real deployment
  cannot treat a client-supplied origin as authentication — the browser CORS check
  and the body `origin` are demo-grade. Production needs signed app credentials
  and/or verified origins.
- **No transport security or auth between app and gateway.** The gateway listens on
  `127.0.0.1` and assumes a trusted local caller. Exposing it beyond localhost
  requires TLS, authentication, and rate limiting.
- **Local files are not encrypted or access-controlled** beyond OS file
  permissions. Sessions, spend counters, ownership, and the audit log live as plain
  JSON/JSONL under the `--data` directory.
- **The audit log is append-only but not tamper-evident.** There is no signing or
  hash chaining; anyone with file access can alter history.

For how these would be addressed, see [production-roadmap.md](./production-roadmap.md).
