# Running Against a Real Fiber Testnet Node

The default demo runs against the bundled mock (`pnpm demo`). This page covers
running FiberGuard against a **real Fiber testnet node** — which the gateway
supports with **no code changes**; only the upstream URL and the RUSD asset config
differ.

```bash
pnpm demo:testnet
```

That one command (via `scripts/testnet.sh`) downloads the `fnn` binary, boots a
real testnet node, points the gateway at it (`examples/fiberguard.testnet.yml`),
starts the demos + approval UI, runs the story against the live node, and then asks
whether to leave the stack running. Everything it creates lives under `.fiber-node/`
(gitignored); the node's key/address persist across runs.

## The two layers

| Layer | Do you run it? | Notes |
| --- | --- | --- |
| **Fiber node (`fnn`)** | **Yes, locally** | Lightweight (~26 MB binary). This is FiberGuard's `--upstream` (`http://127.0.0.1:8227`). There is no public Fiber *RPC* — Fiber RPC controls that node's channels and funds. |
| **CKB layer-1 node** | **No** | `fnn` talks to CKB testnet via the public RPC `https://testnet.ckbapp.dev/` (set in the testnet `config.yml`). No CKB full node required. |

The public Fiber testnet nodes referenced in the docs are **channel/relay peers you
open channels *with*** (bootnodes in the config), not RPC endpoints.

## What works with an unfunded node (out of the box)

`pnpm demo:testnet` boots a node with a freshly generated, **unfunded** key. Against
that node the following are fully real:

- **`node.read`** → live testnet `node_info` (version, chain hash, real peer count).
- **`channels.read_summary`** → real counts (`{0,0,0}` until you open channels).
- **`invoice.create`** → a **real `fibt1…` testnet RUSD invoice** from the node.
- **Every policy block** — `AMOUNT_EXCEEDS_SESSION_LIMIT`, `ACTION_EXPLICITLY_DENIED`,
  `ACTION_NOT_ALLOWED`, `SESSION_REVOKED`, etc. — because FiberGuard blocks those
  **before** the request ever reaches the node.
- A **policy-allowed payment** is forwarded to the real node; with no funded channel
  the node itself refuses it, and FiberGuard surfaces that cleanly as a typed
  `UPSTREAM_FIBER_ERROR` (HTTP 502).

That already demonstrates the entire security thesis: apps use real Fiber
capabilities, and everything unsafe is stopped — most of it before the node.

## Making a *successful* payment (optional, needs funding)

A settled `payment.pay_invoice` needs the node to have a funded channel with
outbound liquidity. This is inherently not instant (faucet + on-chain
confirmations), so it's a manual, one-time setup:

1. **Get the node's CKB address:**
   ```bash
   .fiber-node/bin/fnn-cli -u http://127.0.0.1:8227 info node
   ```
2. **Fund it from the CKB testnet faucet** (testnet CKB), and obtain testnet **RUSD**
   for the node's address.
3. **Open a channel** to a public relay node (a bootnode from the testnet
   `config.yml`) and wait for on-chain confirmation, e.g. via `fnn-cli channel …`.
   Auto-accept for incoming channels is already enabled in the config.
4. **Pay a matching invoice.** Create the invoice on the counterparty (or use the
   merchant demo) and pay the **exact** amount — the real node validates that the
   paid amount matches the invoice (paying `0.5` against a `10` RUSD invoice fails
   with *"amount does not match the invoice"*).

Once a funded channel exists, the agent demo's "Pay 0.5 RUSD" settles for real and
the story is fully green end to end.

## Configuration

- **Policy:** `examples/fiberguard.testnet.yml` — identical apps/limits to the mock
  policy, but the RUSD asset uses the **real testnet UDT type script**:
  ```yaml
  RUSD:
    decimals: 8
    udt_type_script:
      code_hash: "0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a"
      hash_type: type
      args: "0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b"
  ```
- **`FIBER_SECRET_KEY_PASSWORD`** encrypts the node's CKB key at rest. `demo:testnet`
  defaults it to `fiberguard-demo`; override it for anything you actually fund.
- **Env knobs** for `scripts/testnet.sh`: `FNN_VERSION`, `GW_PORT`, `WITH_DEMOS=0|1`,
  `KEEP_OPEN=0|1`, `FIBER_SECRET_KEY_PASSWORD`.

## Manual bring-up (without the script)

```bash
# 1. Start a testnet fnn (see nervosnetwork/fiber releases), RPC on 127.0.0.1:8227
FIBER_SECRET_KEY_PASSWORD=… ./fnn -c config.yml -d ./node

# 2. Point the gateway at it
node packages/gateway/dist/cli.js start \
  --policy examples/fiberguard.testnet.yml \
  --upstream http://127.0.0.1:8227 \
  --port 8787 \
  --approval-ui apps/approval-ui/out
```

## Verified — including a fully settled payment

On this project's setup, a real `fnn` v0.9.0-rc7 testnet node booted, connected to
real testnet peers, and the FiberGuard gateway drove it unmodified: live `node.read`,
a real `fibt1…` invoice from `invoice.create`, and all policy blocks.

**A complete, policy-approved payment settled on-chain-backed Fiber testnet through
FiberGuard (2026-07-06):**

1. Two local testnet nodes, A (agent) and B (payee), each funded from the CKB faucet
   (100k CKB each; B needs ~100 CKB for its channel-reserve output).
2. Opened a 500 CKB channel A→B (B auto-accepts once funded); it reached
   `ChannelReady` after its funding tx confirmed.
3. B issued a 1 CKB invoice (`payment_hash 0x68814f85…`).
4. Through the gateway on the settlement policy: agent requested a CKB payment
   session → operator approved → `POST /intent/pay-invoice` → **`send_payment`
   settled**: payment `Success`, invoice `Paid`, channel balance moved A 401→400 /
   B 0→1 CKB. The agent then read its own settled payment via `payment.read_own`,
   and the whole thing is in the audit log (`session_requested` → `session_approved`
   → `intent_allowed pay_invoice` → `intent_allowed read_own`).

That is the full thesis proven live: a scoped, approved, spend-limited intent turned
into a real Fiber settlement, with the gateway unchanged from the mock build. See
[security-limitations.md](./security-limitations.md) for the honest boundaries.
