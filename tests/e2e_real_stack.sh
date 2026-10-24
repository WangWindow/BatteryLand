#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
BACKEND_PORT="${E2E_BACKEND_PORT:-8011}"
DATA_DIR="${E2E_DATA_DIR:-$(pwd)/var/e2e-real-training}"
rm -rf "$DATA_DIR"
mkdir -p "$DATA_DIR"

export BATTERYLAND_SOURCE_ROOTS='{}'

exec uv run batteryland serve --data-dir "$DATA_DIR" --port "$BACKEND_PORT"
