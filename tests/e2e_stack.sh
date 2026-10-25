#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
BACKEND_PORT="${E2E_BACKEND_PORT:-8000}"
export E2E_BACKEND_PORT="$BACKEND_PORT"
if [[ -z "${E2E_DATA_DIR:-}" ]]; then
  E2E_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/batteryland-e2e.XXXXXX")"
  export E2E_DATA_DIR
  trap 'rm -rf "$E2E_DATA_DIR"' EXIT
fi

uv run python tests/e2e_server.py
