#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
BACKEND_PORT="${E2E_BACKEND_PORT:-8000}"
export E2E_BACKEND_PORT="$BACKEND_PORT"
export E2E_DATA_DIR="${E2E_DATA_DIR:-$(pwd)/var/e2e-workbench}"

uv run python tests/e2e_server.py &
backend_pid=$!
scheduler_pid=""
cleanup() {
  if [[ -n "$scheduler_pid" ]]; then
    kill "$scheduler_pid" 2>/dev/null || true
  fi
  kill "$backend_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 200); do
  if curl --silent --fail "http://127.0.0.1:${BACKEND_PORT}/api/v1/capabilities" >/dev/null; then
    break
  fi
  sleep 0.1
done

uv run python -m simple_impl.scheduler \
  --base-url "http://127.0.0.1:${BACKEND_PORT}" \
  --interval 0.3 &
scheduler_pid=$!

wait "$backend_pid"
