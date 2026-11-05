#!/usr/bin/env bash
set -euo pipefail

# Start the three BatteryLife pages with the prepared server-side catalog.
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
source_root="/data/BatteryLife_Processed"
catalog="$project_root/var/data-layer/catalog.sqlite3"

if [[ ! -d "$source_root/Life labels" ]]; then
  printf 'BatteryLife source directory is unavailable: %s\n' "$source_root" >&2
  exit 1
fi
if [[ ! -s "$catalog" ]]; then
  printf 'BatteryLife catalog is missing: %s\n' "$catalog" >&2
  printf 'Prepare it first with: .venv/bin/python -m batteryland.data_layer.prepare\n' >&2
  exit 1
fi

local_bun="$project_root/var/tools/bun-1.4.2/bun-linux-x64"
if ! command -v bun >/dev/null 2>&1 && [[ -x "$local_bun/bun" ]]; then
  export PATH="$local_bun:$PATH"
fi

export BATTERYLAND_SOURCE_ROOTS='{"battery_life":"/data/BatteryLife_Processed"}'
export BATTERYLAND_DATA_DIR="$project_root/var"
export BATTERYLAND_BACKEND_PORT=18000
export BATTERYLAND_UI_PORT=15173

exec "$project_root/scripts/run.sh"
