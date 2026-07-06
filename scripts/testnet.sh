#!/usr/bin/env bash
#
# FiberGuard Session — REAL testnet demo.
#
# Spins up a real Fiber testnet node (fnn), points the FiberGuard gateway at it,
# runs the demo story against the live node, then (optionally) leaves the whole
# stack running so you can keep testing in the browser.
#
#   pnpm demo:testnet
#
# Everything it downloads/creates lives under .fiber-node/ (gitignored). The node
# data (key + address) persists across runs, so once you fund the node its funds
# stay put.
#
# Env knobs:
#   FNN_VERSION               fnn release tag           [default: v0.9.0-rc7]
#   FIBER_SECRET_KEY_PASSWORD password for the CKB key  [default: fiberguard-demo]
#   GW_PORT                   gateway port              [default: 8787]
#   WITH_DEMOS=0|1            also start the 3 demo UIs  [default: 1]
#   KEEP_OPEN=0|1             skip the prompt: tear down (0) or stay up (1)
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FNN_VERSION="${FNN_VERSION:-v0.9.0-rc7}"
FIBER_SECRET_KEY_PASSWORD="${FIBER_SECRET_KEY_PASSWORD:-fiberguard-demo}"
export FIBER_SECRET_KEY_PASSWORD
GW_PORT="${GW_PORT:-8787}"
FNN_RPC_PORT="${FNN_RPC_PORT:-8227}"
WITH_DEMOS="${WITH_DEMOS:-1}"
POLICY="examples/fiberguard.testnet.yml"

NODE_HOME="$ROOT/.fiber-node"
BIN_DIR="$NODE_HOME/bin"
DATA_DIR="$NODE_HOME/data"
CACHE_DIR="$NODE_HOME/cache"
GW_DATA="$NODE_HOME/gateway-data"
GW="http://127.0.0.1:$GW_PORT"
FNN_RPC="http://127.0.0.1:$FNN_RPC_PORT"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
dim()  { printf '\033[2m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
no()   { printf '  \033[31m✗\033[0m %s\n' "$*"; }

pids=()
cleanup() {
  echo; bold "==> Shutting down…"
  for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}

########################################################################
# 1. Fetch the fnn binary (cached)
########################################################################
fetch_fnn() {
  if [ -x "$BIN_DIR/fnn" ]; then ok "fnn present ($BIN_DIR/fnn)"; return; fi
  mkdir -p "$BIN_DIR" "$CACHE_DIR"
  local arch; arch="$(uname -m)"
  case "$arch" in
    x86_64)  asset="fnn_${FNN_VERSION}-x86_64-linux-portable.tar.gz" ;;
    aarch64) asset="fnn_${FNN_VERSION}-aarch64-linux-portable.tar.gz" ;;
    *) no "unsupported arch: $arch"; exit 1 ;;
  esac
  local url="https://github.com/nervosnetwork/fiber/releases/download/${FNN_VERSION}/${asset}"
  bold "==> Downloading fnn ${FNN_VERSION} ($arch)…"
  dim "    $url"
  curl -fsSL --retry 3 -o "$CACHE_DIR/$asset" "$url" || { no "download failed"; exit 1; }
  tar -xzf "$CACHE_DIR/$asset" -C "$BIN_DIR"
  chmod +x "$BIN_DIR/fnn" "$BIN_DIR/fnn-cli" 2>/dev/null || true
  ok "fnn downloaded + extracted"
}

########################################################################
# 2. Prepare the node data dir (config + CKB key)
########################################################################
prepare_node() {
  mkdir -p "$DATA_DIR/ckb"
  if [ ! -f "$DATA_DIR/config.yml" ]; then
    cp "$BIN_DIR/config/testnet/config.yml" "$DATA_DIR/config.yml"
    ok "testnet config installed"
  else
    ok "testnet config present"
  fi
  # CKB wallet key: plaintext 32-byte hex on first run; fnn migrates it to an
  # encrypted file (AES-256-GCM via FIBER_SECRET_KEY_PASSWORD) at boot.
  if [ ! -f "$DATA_DIR/ckb/key" ]; then
    head -c32 /dev/urandom | xxd -p -c 64 | tr -d '\n' > "$DATA_DIR/ckb/key"
    ok "generated a fresh CKB key (unfunded)"
  else
    ok "CKB key present"
  fi
}

########################################################################
# 3. Boot fnn + wait for RPC
########################################################################
start_node() {
  bold "==> Starting real Fiber testnet node (fnn)…"
  ( cd "$ROOT" && RUST_LOG="${RUST_LOG:-info}" "$BIN_DIR/fnn" -c "$DATA_DIR/config.yml" -d "$DATA_DIR" ) \
    > "$NODE_HOME/fnn.log" 2>&1 &
  pids+=("$!")
  local up=""
  for i in $(seq 1 60); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 -X POST "$FNN_RPC" \
             -H 'content-type: application/json' \
             -d '{"id":1,"jsonrpc":"2.0","method":"node_info","params":[]}' 2>/dev/null)" = "200" ]; then
      up="$i"; break
    fi
    sleep 1
  done
  if [ -z "$up" ]; then no "fnn RPC did not come up — see $NODE_HOME/fnn.log"; exit 1; fi
  local peers; peers=$(curl -s -X POST "$FNN_RPC" -H 'content-type: application/json' \
    -d '{"id":1,"jsonrpc":"2.0","method":"node_info","params":[]}' \
    | python3 -c 'import sys,json
d=json.load(sys.stdin)["result"]
print("v%s  peers=%d  channels=%d" % (d["version"], int(d["peers_count"],16), int(d["channel_count"],16)))' 2>/dev/null)
  ok "fnn RPC up on $FNN_RPC after ${up}s  ($peers)"
}

########################################################################
# 4. Boot the gateway pointed at the real node
########################################################################
start_gateway() {
  [ -f packages/gateway/dist/cli.js ] || { bold "==> Building workspace…"; pnpm -r --if-present build >/dev/null 2>&1; }
  bold "==> Starting FiberGuard gateway (upstream = real node)…"
  node packages/gateway/dist/cli.js start \
    --policy "$POLICY" --upstream "$FNN_RPC" --port "$GW_PORT" \
    --data "$GW_DATA" --approval-ui apps/approval-ui/out \
    > "$NODE_HOME/gateway.log" 2>&1 &
  pids+=("$!")
  for i in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "$GW/healthz" 2>/dev/null)" = "200" ] && { ok "gateway up on $GW"; return; }
    sleep 1
  done
  no "gateway did not come up — see $NODE_HOME/gateway.log"; exit 1
}

start_demos() {
  [ "$WITH_DEMOS" = "1" ] || return
  bold "==> Starting the 3 demo apps (next dev)…"
  pnpm --filter @fiberguard/agent-demo     dev > "$NODE_HOME/agent.log"     2>&1 & pids+=("$!")
  pnpm --filter @fiberguard/merchant-demo  dev > "$NODE_HOME/merchant.log"  2>&1 & pids+=("$!")
  pnpm --filter @fiberguard/dashboard-demo dev > "$NODE_HOME/dashboard.log" 2>&1 & pids+=("$!")
  dim "    (compiling in the background; give them ~40s before clicking)"
}

########################################################################
# 5. Narrated story against the REAL node
########################################################################
jqr() { python3 -c 'import sys,json;print(json.load(sys.stdin).get(sys.argv[1],""))' "$1"; }
post() { curl -s -X POST "$GW$1" -H 'content-type: application/json' ${3:+-H "origin: $3"} -d "$2"; }
get()  { curl -s "$GW$1" ${2:+-H "origin: $2"}; }

run_story() {
  echo; bold "======================================================================"
  bold "  FiberGuard × real Fiber testnet — story"
  bold "======================================================================"

  bold "[dashboard] read node info + channel summary (REAL node)"
  local d; d=$(post /session/request '{"app_id":"dashboard-demo","origin":"http://localhost:3003","requested_permissions":[{"action":"node.read"},{"action":"channels.read_summary"},{"action":"payment.read_own"}]}' http://localhost:3003)
  local dsess; dsess=$(echo "$d" | jqr session_id)
  get "/node/info?session_id=$dsess" http://localhost:3003 \
    | python3 -c 'import sys,json;n=json.load(sys.stdin)["node"];print("  node:",n["version"],"chain",n["chain_hash"][:14]+"…","peers",int(n["peers_count"],16))' 2>/dev/null && ok "node.read allowed (live testnet data)"
  get "/channels/summary?session_id=$dsess" http://localhost:3003 \
    | python3 -c 'import sys,json;s=json.load(sys.stdin)["summary"];print("  channels:",s)' 2>/dev/null && ok "channels.read_summary allowed"

  echo; bold "[merchant] create a 10 RUSD invoice (REAL node_new_invoice, no funds needed)"
  local m; m=$(post /session/request '{"app_id":"merchant-demo","origin":"http://localhost:3002","requested_permissions":[{"action":"invoice.create","asset":"RUSD","max_amount_per_invoice":"100"},{"action":"payment.read_own"}]}' http://localhost:3002)
  local msess; msess=$(echo "$m" | jqr session_id)
  local inv; inv=$(post /intent/create-invoice "{\"session_id\":\"$msess\",\"app_id\":\"merchant-demo\",\"origin\":\"http://localhost:3002\",\"asset\":\"RUSD\",\"amount\":\"10\",\"description\":\"Order #1234\"}" http://localhost:3002 | jqr invoice)
  if [ -n "$inv" ] && [ "$inv" != "None" ]; then ok "invoice.create allowed → ${inv:0:34}…"; else no "invoice.create failed"; fi

  echo; bold "[agent] request → approve → then hit the guards (REAL node)"
  local srid; srid=$(post /session/request '{"app_id":"agent-demo","origin":"http://localhost:3001","requested_permissions":[{"action":"payment.pay_invoice","asset":"RUSD","max_amount_per_payment":"1","daily_limit":"5","expires_in":"10m"},{"action":"payment.read_own"}]}' http://localhost:3001 | jqr session_request_id)
  local asess; asess=$(post /session/approve "{\"session_request_id\":\"$srid\",\"approval_type\":\"session\"}" | jqr session_id)
  ok "session approved: $asess"
  local r
  r=$(post /intent/pay-invoice "{\"session_id\":\"$asess\",\"app_id\":\"agent-demo\",\"origin\":\"http://localhost:3001\",\"invoice\":\"fibt1x\",\"asset\":\"RUSD\",\"amount\":\"100\",\"reason\":\"x\"}" http://localhost:3001 | jqr reason)
  [ "$r" = "AMOUNT_EXCEEDS_SESSION_LIMIT" ] && ok "pay 100 RUSD → blocked $r (before the node)" || no "unexpected: $r"
  r=$(post /intent/action "{\"session_id\":\"$asess\",\"app_id\":\"agent-demo\",\"origin\":\"http://localhost:3001\",\"action\":\"channel.open\"}" http://localhost:3001 | jqr reason)
  [ "$r" = "ACTION_EXPLICITLY_DENIED" ] && ok "channel.open → blocked $r (before the node)" || no "unexpected: $r"
  # Policy-allowed payment reaches the node; without a funded channel the node itself refuses.
  r=$(post /intent/pay-invoice "{\"session_id\":\"$asess\",\"app_id\":\"agent-demo\",\"origin\":\"http://localhost:3001\",\"invoice\":\"$inv\",\"asset\":\"RUSD\",\"amount\":\"0.5\",\"reason\":\"real\"}" http://localhost:3001 | jqr reason)
  if [ "$r" = "WITHIN_POLICY" ] || [ -z "$r" ]; then ok "pay 0.5 RUSD → forwarded + settled by the node 🎉 (funded channel present)"
  else dim "  pay 0.5 RUSD → policy-allowed, reached the node, node replied: $r"
       dim "  (expected until the node has a funded channel — see docs/testnet.md)"; fi

  echo; bold "[audit] decisions recorded"
  get "/audit" | python3 -c 'import sys,json;print("  audit events:",len(json.load(sys.stdin)["events"]))' 2>/dev/null
  bold "======================================================================"
}

########################################################################
# main
########################################################################
trap cleanup EXIT INT TERM
bold "FiberGuard Session — real testnet bring-up"
fetch_fnn
prepare_node
start_node
start_demos      # start early so they compile while we run the story
start_gateway
run_story

echo
cat <<EOF
$(bold "Stack is live:")
  Fiber testnet node (fnn) RPC   $FNN_RPC
  FiberGuard gateway + approval  $GW/
$( [ "$WITH_DEMOS" = "1" ] && printf '  Agent / Merchant / Dashboard   http://localhost:3001 / 3002 / 3003\n' )
  Node logs                      $NODE_HOME/fnn.log
  Node CKB address for faucet:   run  $BIN_DIR/fnn-cli -u $FNN_RPC info node   (see docs/testnet.md)
EOF

# Leave-open decision
keep=""
if   [ "${KEEP_OPEN:-}" = "1" ]; then keep="yes"
elif [ "${KEEP_OPEN:-}" = "0" ]; then keep="no"
elif [ -t 0 ]; then
  echo; read -rp "$(bold 'Leave the whole stack running so you can keep testing? [Y/n] ')" ans
  case "${ans:-y}" in [Nn]*) keep="no";; *) keep="yes";; esac
else keep="no"; fi

if [ "$keep" = "yes" ]; then
  bold "==> Leaving everything up. Press Ctrl-C to stop."
  wait
else
  bold "==> Tearing down (node data under $DATA_DIR is preserved for next time)."
fi
