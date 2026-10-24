#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
BACKEND_PORT="${E2E_BACKEND_PORT:-8011}"
FRONTEND_PORT="${E2E_FRONTEND_PORT:-5174}"
LOG_DIR="${TMPDIR:-/tmp}"

E2E_BACKEND_PORT="$BACKEND_PORT" bash tests/e2e_real_stack.sh \
  >"$LOG_DIR/batteryland-e2e-real-backend.log" 2>&1 &
stack_pid=$!
vite_pid=""
cleanup() {
  if [[ -n "$vite_pid" ]]; then
    kill "$vite_pid" 2>/dev/null || true
  fi
  kill "$stack_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 300); do
  if curl --silent --fail "http://127.0.0.1:${BACKEND_PORT}/api/v1/capabilities" >/dev/null; then
    break
  fi
  sleep 0.2
done

(
  cd "$ROOT/src/batteryland_ui"
  VITE_PROXY_TARGET="http://127.0.0.1:${BACKEND_PORT}" \
    bun run dev -- --host 127.0.0.1 --port "$FRONTEND_PORT" \
    >"$LOG_DIR/batteryland-e2e-real-vite.log" 2>&1
) &
vite_pid=$!

for _ in $(seq 1 300); do
  if curl --silent --fail "http://127.0.0.1:${FRONTEND_PORT}" >/dev/null; then
    break
  fi
  sleep 0.2
done

cd "$ROOT/src/batteryland_ui"
E2E_BASE_URL="http://127.0.0.1:${FRONTEND_PORT}" E2E_REAL_TRAINING=1 \
  bunx playwright test e2e/real-mytask.spec.ts
