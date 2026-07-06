#!/usr/bin/env bash
#
# FiberGuard Session — LIVE testnet off-chain settlement, fully scripted.
#
#   pnpm demo:testnet:settle
#
# Orchestrates a real Fiber Network payment on the live CKB testnet, gated by
# FiberGuard: two local fnn nodes (A = agent's node, B = payee), a real 500-CKB
# payment channel opened + anchored on CKB L1, and a policy-approved pay_invoice
# that settles off-chain in seconds — while FiberGuard blocks the unauthorized
# RPC actions. It also proves the security thesis side-by-side in the audit log.
#
# Idempotent: reuses funded nodes and an already-open channel on re-runs (no L1
# wait, no re-funding). On a fresh clone it derives each node's CKB address,
# pauses, and tells you exactly which faucet address to fund, then continues.
#
# Requires: bash, curl, openssl, python3, node, pnpm. Everything it creates lives
# under .fiber-node/ (gitignored). The stack is LEFT RUNNING at the end.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
LIB="$ROOT/scripts/lib"
NODE_HOME="$ROOT/.fiber-node"
BIN_DIR="$NODE_HOME/bin"; CACHE_DIR="$NODE_HOME/cache"
export FIBER_SECRET_KEY_PASSWORD="${FIBER_SECRET_KEY_PASSWORD:-fiberguard-demo}"

FNN_VERSION="${FNN_VERSION:-v0.9.0-rc7}"
CKB_RPC="https://testnet.ckbapp.dev/"
SECP="0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8"
A_RPC=8227; A_P2P=8228; B_RPC=8237; B_P2P=8238; GW_PORT="${GW_PORT:-8787}"
FUND_SHANNONS=50000000000      # 500 CKB channel from A
PAY_CKB=1                       # settle 1 CKB, agent -> payee
PAY_SHANNONS=100000000
A_MIN_CKB=550; B_MIN_CKB=120    # min balances to proceed (channel + reserves + fees)
GW="http://127.0.0.1:$GW_PORT"

c_b=$'\033[1m'; c_d=$'\033[2m'; c_g=$'\033[32m'; c_r=$'\033[31m'; c_y=$'\033[33m'; c_0=$'\033[0m'
say()  { printf '%s\n' "$*"; }
tag()  { printf "%s[%s]%s %s\n" "$2" "$1" "$c_0" "$3"; }
setup(){ tag SETUP "$c_b" "$*"; }
l1()   { tag "CKB L1" "$c_y" "$*"; }
fib()  { tag "Fiber" "$c_b" "$*"; }
guard(){ tag "FiberGuard" "$c_b" "$*"; }
ok()   { printf "  %s✓%s %s\n" "$c_g" "$c_0" "$*"; }
blk()  { printf "  %s⛔ %s%s\n" "$c_r" "$*" "$c_0"; }
hr()   { printf '%s──────────────────────────────────────────────────────────────%s\n' "$c_d" "$c_0"; }

pids=()
cleanup_on_err(){ :; }  # stack is intentionally left running

acli(){ local port="$1"; shift; "$BIN_DIR/fnn-cli" -u "http://127.0.0.1:$port" "$@" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g'; }
rpc_up(){ [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 -X POST "http://127.0.0.1:$1" -H 'content-type: application/json' -d '{"id":1,"jsonrpc":"2.0","method":"node_info","params":[]}' 2>/dev/null)" = "200" ]; }

# on-chain capacity (CKB) of a lock args
chain_ckb(){
  local args="$1"
  curl -s --max-time 12 -X POST "$CKB_RPC" -H 'content-type: application/json' \
    -d '{"id":1,"jsonrpc":"2.0","method":"get_cells_capacity","params":[{"script":{"code_hash":"'"$SECP"'","hash_type":"type","args":"'"$args"'"},"script_type":"lock"}]}' \
    | python3 -c 'import sys,json
try: print(int(json.load(sys.stdin)["result"]["capacity"],16)//100000000)
except Exception: print(-1)'
}

########################################################################
setup "FiberGuard × real CKB testnet — scripted settlement"
hr

# 1. fnn binary --------------------------------------------------------
fetch_fnn(){
  [ -x "$BIN_DIR/fnn" ] && { ok "fnn present"; return; }
  mkdir -p "$BIN_DIR" "$CACHE_DIR"
  local arch; arch="$(uname -m)"; local plat
  case "$arch" in x86_64) plat=x86_64-linux;; aarch64) plat=aarch64-linux;; *) say "unsupported arch $arch"; exit 1;; esac
  local asset="fnn_${FNN_VERSION}-${plat}-portable.tar.gz"
  setup "downloading fnn ${FNN_VERSION} ($arch)…"
  curl -fsSL --retry 3 -o "$CACHE_DIR/$asset" "https://github.com/nervosnetwork/fiber/releases/download/${FNN_VERSION}/${asset}" || { say "download failed"; exit 1; }
  tar -xzf "$CACHE_DIR/$asset" -C "$BIN_DIR"; chmod +x "$BIN_DIR/fnn" "$BIN_DIR/fnn-cli"
  ok "fnn downloaded"
}
fetch_fnn

# 2. node data dirs + keys + derived addresses -------------------------
# args: name base rpc_port p2p_port
prepare_node(){
  local name="$1" base="$2" rpc="$3" p2p="$4"
  local addrfile="$NODE_HOME/$name.address" argsfile="$NODE_HOME/$name.args"
  mkdir -p "$base/ckb"
  if [ ! -f "$base/config.yml" ]; then
    python3 -c 'import sys
s=open(sys.argv[1]).read()
s=s.replace("/ip4/0.0.0.0/tcp/8228","/ip4/0.0.0.0/tcp/'"$p2p"'").replace("127.0.0.1:8227","127.0.0.1:'"$rpc"'")
open(sys.argv[2],"w").write(s)' "$BIN_DIR/config/testnet/config.yml" "$base/config.yml"
  fi
  if [ ! -f "$base/ckb/key" ]; then
    # fresh key: generate, derive + cache address (only chance — fnn encrypts it on boot)
    local pem; pem=$(mktemp)
    openssl ecparam -name secp256k1 -genkey -noout -out "$pem" 2>/dev/null
    local pub; pub=$(openssl ec -in "$pem" -pubout -conv_form compressed -outform DER 2>/dev/null | xxd -p -c 400); pub=${pub: -66}
    local privder; privder=$(openssl ec -in "$pem" -outform DER 2>/dev/null | xxd -p -c 400)
    local priv; priv=$(python3 -c 'import sys;d=sys.argv[1];i=d.find("0201010420");print(d[i+10:i+10+64])' "$privder")
    printf '%s' "$priv" > "$base/ckb/key"; rm -f "$pem"
    python3 "$LIB/ckb-address.py" "$pub" ckt > "$addrfile"
    python3 -c 'import sys,hashlib;print("0x"+hashlib.blake2b(bytes.fromhex(sys.argv[1]),digest_size=32,person=b"ckb-default-hash").hexdigest()[:40])' "$pub" > "$argsfile"
    ok "node $name: generated key + derived address"
  elif [ ! -f "$addrfile" ]; then
    say "${c_r}node $name has a key but no cached address (encrypted; cannot re-derive).${c_0}"
    say "Delete $base/ckb to regenerate, or restore $addrfile."; exit 1
  fi
}

start_node(){
  local name="$1" base="$2" rpc="$3"
  if rpc_up "$rpc"; then ok "node $name already running (:$rpc)"; return; fi
  setup "starting node $name (:$rpc)…"
  RUST_LOG="${RUST_LOG:-info}" "$BIN_DIR/fnn" -c "$base/config.yml" -d "$base" > "$NODE_HOME/fnn-$name.log" 2>&1 &
  pids+=("$!")
  for i in $(seq 1 40); do rpc_up "$rpc" && { ok "node $name up (:$rpc)"; return; }; sleep 1; done
  say "node $name failed to start — see $NODE_HOME/fnn-$name.log"; exit 1
}

prepare_node A "$NODE_HOME/data"   "$A_RPC" "$A_P2P"
prepare_node B "$NODE_HOME/data-b" "$B_RPC" "$B_P2P"
start_node   A "$NODE_HOME/data"   "$A_RPC"
start_node   B "$NODE_HOME/data-b" "$B_RPC"

A_ARGS=$(cat "$NODE_HOME/A.args"); A_ADDR=$(cat "$NODE_HOME/A.address")
B_ARGS=$(cat "$NODE_HOME/B.args"); B_ADDR=$(cat "$NODE_HOME/B.address")
hr

# 3. funding gate ------------------------------------------------------
wait_funded(){
  local name="$1" addr="$2" args="$3" min="$4"
  local bal; bal=$(chain_ckb "$args")
  if [ "$bal" -ge "$min" ] 2>/dev/null; then ok "node $name funded: ${bal} CKB (on-chain)"; return; fi
  say
  l1  "Node $name needs testnet CKB (has ${bal:-0}, needs ≥ ${min})."
  say "  ${c_b}Fund this address at https://faucet.nervos.org/ :${c_0}"
  say "  ${c_y}${addr}${c_0}"
  l1  "waiting for the deposit to confirm on CKB L1 (poll every 20s)…"
  for i in $(seq 1 180); do
    bal=$(chain_ckb "$args")
    [ "$bal" -ge "$min" ] 2>/dev/null && { ok "node $name funded: ${bal} CKB"; return; }
    printf "\r  ${c_d}[CKB L1] still waiting… ${i}0s, balance=%s CKB${c_0}   " "${bal:-0}"; sleep 20
  done
  say; say "${c_r}timed out waiting for node $name funding${c_0}"; exit 1
}
guard "Checking on-chain balances (real CKB testnet)…"
wait_funded A "$A_ADDR" "$A_ARGS" "$A_MIN_CKB"
wait_funded B "$B_ADDR" "$B_ARGS" "$B_MIN_CKB"
hr

# 4. peer link ---------------------------------------------------------
BPEER=$(grep -aoE 'tcp/'"$B_P2P"'[^ ]*p2p/[A-Za-z0-9]+' "$NODE_HOME/fnn-B.log" 2>/dev/null | head -1 | grep -oE 'p2p/[A-Za-z0-9]+' | cut -d/ -f2)
BPUB=$(acli "$B_RPC" info node_info | grep -E '^pubkey:' | awk '{print $2}')
if [ -n "$BPEER" ]; then
  BADDR="/ip4/127.0.0.1/tcp/$B_P2P/p2p/$BPEER"
  if acli "$A_RPC" peer list_peers | grep -q "$BPEER"; then ok "A ⇄ B already connected"
  else acli "$A_RPC" peer connect_peer --address "$BADDR" --save true >/dev/null; sleep 3
       acli "$A_RPC" peer list_peers | grep -q "$BPEER" && ok "A ⇄ B connected" || fib "connect pending (will retry at channel open)"; fi
fi
hr

# 5. channel (reuse or open + anchor) ----------------------------------
ready_channel(){  # prints "channel_id local_shannons" of a ChannelReady chan with local>=PAY, else empty
  acli "$A_RPC" channel list_channels -o json | python3 -c '
import sys,json
need=int(sys.argv[1])
for c in json.load(sys.stdin).get("channels",[]):
    if c.get("state",{}).get("state_name")=="ChannelReady":
        lb=c.get("local_balance","0x0"); lb=int(str(lb),16) if isinstance(lb,str) else int(lb)
        if lb>=need: print(c.get("channel_id",""), lb); break' "$PAY_SHANNONS"
}
CH=$(ready_channel)
if [ -n "$CH" ]; then
  CHID=$(echo "$CH" | awk '{print $1}'); CHLOCAL=$(echo "$CH" | awk '{print $2}')
  fib "Reusing existing state channel $(printf '%s' "$CHID" | cut -c1-18)… (A local $((CHLOCAL/100000000)) CKB) — no L1 wait needed"
else
  fib "Opening a $((FUND_SHANNONS/100000000))-CKB payment channel A → B…"
  acli "$A_RPC" channel open_channel --pubkey "$BPUB" --funding-amount "$FUND_SHANNONS" --public false | grep -i temporary_channel_id || true
  l1  "Waiting for channel funding transaction to anchor on CKB L1…"
  say "  ${c_d}(A state channel trades ONE L1 confirmation for unlimited instant off-chain payments.)${c_0}"
  for i in $(seq 1 160); do
    st=$(acli "$A_RPC" channel list_channels -o json | python3 -c 'import sys,json
cs=json.load(sys.stdin).get("channels",[]);print("|".join(c.get("state",{}).get("state_name","?") for c in cs) or "NONE")')
    case "$st" in *ChannelReady*) say; ok "funding tx anchored — channel is READY"; break;; esac
    printf "\r  ${c_d}[CKB L1] anchoring… %ss  (state: %s)${c_0}      " "$((i*15))" "$st"; sleep 15
  done
  CH=$(ready_channel); CHID=$(echo "$CH" | awk '{print $1}')
  [ -z "$CHID" ] && { say "${c_r}channel did not reach ChannelReady${c_0}"; exit 1; }
fi
# balances before payment
read A_BEFORE B_BEFORE < <(acli "$A_RPC" channel list_channels -o json | python3 -c '
import sys,json
for c in json.load(sys.stdin).get("channels",[]):
    if c.get("state",{}).get("state_name")=="ChannelReady":
        lb=int(str(c.get("local_balance","0x0")),16); rb=int(str(c.get("remote_balance","0x0")),16)
        print(lb//100000000, rb//100000000); break')
hr

# 6. payee invoice -----------------------------------------------------
fib "Node B (payee) issues a ${PAY_CKB} CKB invoice…"
INV=$(acli "$B_RPC" invoice new_invoice --amount "$PAY_SHANNONS" --currency Fibt --description "FiberGuard live settlement" | grep -oE 'fibt[0-9a-z]+' | head -1)
HASH=$(acli "$B_RPC" invoice parse_invoice --invoice "$INV" | grep -iE 'payment_hash' | grep -oE '0x[0-9a-f]{64}' | head -1)
ok "invoice: $(printf '%s' "$INV" | cut -c1-40)…  (payment_hash $(printf '%s' "$HASH" | cut -c1-14)…)"
hr

# 7. gateway on the real node (fresh audit) ----------------------------
GWDATA="$NODE_HOME/gateway-settle"; rm -rf "$GWDATA"
[ -f packages/gateway/dist/cli.js ] || { setup "building gateway…"; pnpm -r --if-present build >/dev/null 2>&1; }
pid=$(ss -ltnp 2>/dev/null | grep ":$GW_PORT " | grep -oE 'pid=[0-9]+' | grep -oE '[0-9]+' | head -1); [ -n "$pid" ] && kill "$pid" 2>/dev/null; sleep 1
guard "Starting gateway on the real node (policy: fiberguard.testnet-settle.yml)…"
node packages/gateway/dist/cli.js start --policy examples/fiberguard.testnet-settle.yml \
  --upstream "http://127.0.0.1:$A_RPC" --port "$GW_PORT" --data "$GWDATA" \
  --approval-ui apps/approval-ui/out > "$NODE_HOME/gateway-settle.log" 2>&1 &
pids+=("$!")
for i in $(seq 1 20); do [ "$(curl -s -o /dev/null -w '%{http_code}' "$GW/healthz")" = "200" ] && break; sleep 1; done
ok "gateway up on $GW"
hr

# 8. the policy-approved settlement ------------------------------------
guard "Agent requests a CKB payment session (approval-gated)…"
SRID=$(curl -s -X POST "$GW/session/request" -H 'content-type: application/json' -H 'origin: http://localhost:3001' \
  -d '{"app_id":"agent-demo","origin":"http://localhost:3001","requested_permissions":[{"action":"payment.pay_invoice","asset":"CKB","max_amount_per_payment":"100","daily_limit":"500","expires_in":"30m"},{"action":"payment.read_own"}]}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("session_request_id",""))')
ok "session request: $SRID (pending approval)"
guard "Operator approves the session…"
SESS=$(curl -s -X POST "$GW/session/approve" -H 'content-type: application/json' -d "{\"session_request_id\":\"$SRID\",\"approval_type\":\"session\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("session_id",""))')
ok "session approved: $SESS"

guard "Agent pays B's invoice THROUGH FiberGuard (policy-checked → send_payment)…"
PAYRES=$(curl -s -X POST "$GW/intent/pay-invoice" -H 'content-type: application/json' -H 'origin: http://localhost:3001' \
  -d "{\"session_id\":\"$SESS\",\"app_id\":\"agent-demo\",\"origin\":\"http://localhost:3001\",\"invoice\":\"$INV\",\"asset\":\"CKB\",\"amount\":\"$PAY_CKB\",\"reason\":\"live testnet settlement\"}")
echo "$PAYRES" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("  gateway decision:",d.get("decision"),"| status:",d.get("status"),"| reason:",d.get("reason") or "WITHIN_POLICY")'
fib "Settling off-chain over the state channel…"
for i in $(seq 1 15); do
  st=$(acli "$A_RPC" payment get_payment --payment-hash "$HASH" -o json | python3 -c 'import sys,json
try:print(json.load(sys.stdin).get("status","?"))
except Exception:print("?")')
  printf "\r  ${c_d}payment status: %s (%ss)${c_0}    " "$st" "$((i*2))"
  [ "$st" = "Success" ] && { say; ok "PAYMENT SETTLED — status Success"; break; }
  [ "$st" = "Failed" ] && { say; blk "payment failed"; break; }
  sleep 2
done
read A_AFTER B_AFTER < <(acli "$A_RPC" channel list_channels -o json | python3 -c '
import sys,json
for c in json.load(sys.stdin).get("channels",[]):
    if c.get("state",{}).get("state_name")=="ChannelReady":
        print(int(str(c.get("local_balance","0x0")),16)//100000000, int(str(c.get("remote_balance","0x0")),16)//100000000); break')
INVST=$(acli "$B_RPC" invoice get_invoice --payment-hash "$HASH" | grep -iE '^status:' | awk '{print $2}')
ok "off-chain balances moved:  agent(A) ${A_BEFORE} → ${A_AFTER} CKB   |   payee(B) ${B_BEFORE} → ${B_AFTER} CKB"
ok "payee invoice status: ${INVST:-?}"
hr

# 9. FiberGuard blocks the unauthorized RPC actions --------------------
guard "Same session now tries actions the policy forbids…"
R1=$(curl -s -X POST "$GW/intent/action" -H 'content-type: application/json' -H 'origin: http://localhost:3001' \
  -d "{\"session_id\":\"$SESS\",\"app_id\":\"agent-demo\",\"origin\":\"http://localhost:3001\",\"action\":\"channel.open\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("reason"))')
blk "open a channel → BLOCKED $R1 (never reaches the node)"
R2=$(curl -s -X POST "$GW/intent/pay-invoice" -H 'content-type: application/json' -H 'origin: http://localhost:3001' \
  -d "{\"session_id\":\"$SESS\",\"app_id\":\"agent-demo\",\"origin\":\"http://localhost:3001\",\"invoice\":\"fibt1overlimit\",\"asset\":\"CKB\",\"amount\":\"500\",\"reason\":\"overspend\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("reason"))')
blk "pay 500 CKB (over the 100 limit) → BLOCKED $R2 (never reaches the node)"
# agent reads its own settled payment
RO=$(curl -s "$GW/payments/$HASH?session_id=$SESS" -H 'origin: http://localhost:3001' | python3 -c 'import sys,json;print(json.load(sys.stdin).get("payment",{}).get("state"))')
ok "agent reads its OWN settled payment (payment.read_own) → $RO"
hr

# 10. the audit trail --------------------------------------------------
guard "FiberGuard audit log — the whole story, side by side:"
curl -s "$GW/audit" | GREEN="$c_g" RED="$c_r" ZERO="$c_0" DIM="$c_d" python3 -c '
import sys, json, os
g, r, z, d = os.environ["GREEN"], os.environ["RED"], os.environ["ZERO"], os.environ["DIM"]
for e in reversed(json.load(sys.stdin)["events"]):
    allowed = e["decision"] == "allowed"
    color = g if allowed else r
    label = "ALLOW" if allowed else "BLOCK"
    print("  %s%s%s  %-16s %-20s %s%s%s" % (color, label, z, e["event"], e.get("action", ""), d, e["reason"], z))'
hr

# 11. summary — leave running ------------------------------------------
say
say "${c_b}${c_g}✔ LIVE SETTLEMENT COMPLETE.${c_0}"
say "  A real ${PAY_CKB} CKB Fiber payment settled off-chain in seconds, gated by FiberGuard,"
say "  on the live CKB testnet — and every unauthorized RPC action was blocked before the node."
say
say "${c_b}Stack left running:${c_0}"
say "  Fiber node A (agent)   http://127.0.0.1:$A_RPC        addr $A_ADDR"
say "  Fiber node B (payee)   http://127.0.0.1:$B_RPC"
say "  FiberGuard gateway     $GW/  (curl $GW/audit)"
say "  Logs                   $NODE_HOME/*.log"
say "  Re-run  ${c_d}pnpm demo:testnet:settle${c_0}  — reuses this channel instantly (no L1 wait)."
