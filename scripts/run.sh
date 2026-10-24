#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
ui_root="$project_root/src/batteryland_ui"
python="$project_root/.venv/bin/python"
backend_port="${BATTERYLAND_BACKEND_PORT:-8000}"
ui_port="${BATTERYLAND_UI_PORT:-5173}"

if [[ $# -gt 0 ]]; then
  if [[ $# -eq 1 && ( $1 == --help || $1 == -h ) ]]; then
    cat <<'HELP'
Usage: scripts/run.sh

Start the installed backend and frontend; Ctrl+C stops both services.
Paths, including relative overrides, are based on the project root.

Environment:
  BATTERYLAND_BACKEND_PORT     API port (default: 8000)
  BATTERYLAND_UI_PORT          UI port (default: 5173)
  BATTERYLAND_DATA_DIR         Data directory (default: var)
  BATTERYLAND_TRAINING_PYTHON  Training Python (default: .venv-training/bin/python)
  BATTERYLAND_SOURCE_ROOTS     Existing JSON mapping of data-source aliases
HELP
    exit 0
  fi
  printf 'Unknown arguments. Use --help for usage.\n' >&2
  exit 2
fi

if [[ ! -x "$python" ]]; then
  printf 'API environment missing. Run uv sync --locked in the project root.\n' >&2
  exit 1
fi
for tool in bun setsid; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$tool" >&2
    exit 1
  fi
done
if [[ ! -e "$ui_root/node_modules/.bin/vite" ]]; then
  printf 'UI dependencies missing. Run bun install --frozen-lockfile in src/batteryland_ui.\n' >&2
  exit 1
fi

cd -- "$project_root"
data_dir="${BATTERYLAND_DATA_DIR:-var}"
[[ $data_dir == /* ]] || data_dir="$project_root/$data_dir"
export BATTERYLAND_DATA_DIR="$data_dir"
export BATTERYLAND_TRAINING_PYTHON="${BATTERYLAND_TRAINING_PYTHON:-$project_root/.venv-training/bin/python}"
export VITE_PROXY_TARGET="http://127.0.0.1:$backend_port"

pids=()
cleanup() {
  trap - EXIT
  trap '' INT TERM
  for pid in "${pids[@]}"; do
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM -- "$pid" 2>/dev/null || true
  done
  wait "${pids[@]}" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

setsid "$python" -m batteryland.main serve \
  --data-dir "$data_dir" --host 127.0.0.1 --port "$backend_port" &
pids+=("$!")
(
  cd -- "$ui_root"
  exec setsid bun run dev -- --host 127.0.0.1 --port "$ui_port" --strictPort
) &
pids+=("$!")

printf 'UI: http://127.0.0.1:%s\nAPI: http://127.0.0.1:%s/docs\nCtrl+C stops both services.\n' \
  "$ui_port" "$backend_port"
status=0
wait -n "${pids[@]}" || status=$?
exit "$status"
