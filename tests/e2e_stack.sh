#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
BACKEND_PORT="${E2E_BACKEND_PORT:-8000}"
export E2E_BACKEND_PORT="$BACKEND_PORT"
export E2E_DATA_DIR="${E2E_DATA_DIR:-$(pwd)/var/e2e-workbench}"

exec uv run python tests/e2e_server.py
