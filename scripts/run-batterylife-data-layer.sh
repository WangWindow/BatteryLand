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

merged_source_roots="$(python3 -c '
import json
import os
from pathlib import Path
roots = json.loads(os.environ.get("BATTERYLAND_SOURCE_ROOTS", "{}"))
if not isinstance(roots, dict):
    raise SystemExit("BATTERYLAND_SOURCE_ROOTS must be a JSON object")
source = "/data/BatteryLife_Processed"
if "battery_life" in roots and Path(roots["battery_life"]).resolve() != Path(source).resolve():
    raise SystemExit("battery_life source differs from the prepared data-layer catalog")
roots.setdefault("battery_life", source)
print(json.dumps(roots, ensure_ascii=False))
')"
export BATTERYLAND_SOURCE_ROOTS="$merged_source_roots"
export BATTERYLAND_DATA_LAYER_CACHE_DIR="$project_root/var/data-layer"
export BATTERYLAND_BACKEND_PORT="${BATTERYLAND_BACKEND_PORT:-18000}"
export BATTERYLAND_UI_PORT="${BATTERYLAND_UI_PORT:-15173}"

exec "$project_root/scripts/run.sh"
