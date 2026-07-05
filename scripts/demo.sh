#!/usr/bin/env bash
#
# Starts the whole FiberGuard Session demo — mock Fiber node, gateway + approval
# UI, and the three demo apps — and tears them all down on Ctrl-C.
#
#   pnpm demo
#
# Override the upstream to run against a real Fiber node:
#   UPSTREAM=http://127.0.0.1:8114 pnpm demo
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

UPSTREAM="${UPSTREAM:-http://127.0.0.1:8227}"
GW_PORT="${GW_PORT:-8787}"
MOCK_PORT="${MOCK_PORT:-8227}"
DATA_DIR="${DATA_DIR:-.fiberguard}"
POLICY="${POLICY:-examples/fiberguard.yml}"

pids=()
cleanup() {
  echo
  echo "==> Shutting down…"
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "==> Building workspace (packages + approval UI)…"
pnpm -r --if-present build

start() { # name command...
  local name="$1"; shift
  echo "==> Starting $name: $*"
  "$@" &
  pids+=("$!")
}

# Only start the bundled mock when the upstream points at it.
if [ "$UPSTREAM" = "http://127.0.0.1:${MOCK_PORT}" ]; then
  start "mock Fiber node (:$MOCK_PORT)" node packages/fiber-mock/dist/cli.js start --port "$MOCK_PORT"
  sleep 1
else
  echo "==> Using external upstream: $UPSTREAM (mock not started)"
fi

start "gateway + approval UI (:$GW_PORT)" \
  node packages/gateway/dist/cli.js start \
    --policy "$POLICY" --upstream "$UPSTREAM" --port "$GW_PORT" \
    --data "$DATA_DIR" --approval-ui apps/approval-ui/out

start "agent demo (:3001)"     pnpm --filter @fiberguard/agent-demo     dev
start "merchant demo (:3002)"  pnpm --filter @fiberguard/merchant-demo  dev
start "dashboard demo (:3003)" pnpm --filter @fiberguard/dashboard-demo dev

cat <<EOF

==================================================================
  FiberGuard Session demo is up.

    Operator console / approval UI  http://localhost:${GW_PORT}/
    Agent demo                      http://localhost:3001
    Merchant demo                   http://localhost:3002
    Dashboard demo                  http://localhost:3003
    Upstream Fiber RPC              ${UPSTREAM}

  Walk through examples/demo-script.md. Press Ctrl-C to stop everything.
==================================================================
EOF

wait
