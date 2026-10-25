#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
ui_root="$project_root/src/batteryland_ui"
python="$project_root/.venv/bin/python"
backend_port="${BATTERYLAND_BACKEND_PORT:-8000}"
ui_port="${BATTERYLAND_UI_PORT:-5173}"
services_only=0

if [[ $# -gt 0 ]]; then
  if [[ $# -eq 1 && ( $1 == --help || $1 == -h ) ]]; then
    cat <<'HELP'
Usage: scripts/run.sh [--services-only]

Start the FastAPI backend and UI. The backend coordinates training subprocesses.
Use --services-only while verifying backend HTTP contracts.
Paths, including relative overrides, are based on the project root.

Environment:
  BATTERYLAND_BACKEND_PORT     API port (default: 8000)
  BATTERYLAND_UI_PORT          UI port (default: 5173)
  BATTERYLAND_DATA_DIR         Data directory (default: var)
  BATTERYLAND_TRAINING_PYTHON  Training Python (default: .venv-training/bin/python)
  BATTERYLAND_SOURCE_ROOTS     JSON mapping of source aliases to existing dataset folders

The fixed /data/BatteryLife_Processed pool is indexed automatically when present.
BATTERYLAND_SOURCE_ROOTS overrides the fixed root mapping if needed.
HELP
    exit 0
  elif [[ $# -eq 1 && $1 == --services-only ]]; then
    services_only=1
  else
    printf 'Unknown arguments. Use --help for usage.\n' >&2
    exit 2
  fi
fi

if [[ ! -x "$python" ]]; then
  printf 'API environment missing. Run uv sync --locked in the project root.\n' >&2
  exit 1
fi
required_tools=(setsid od tr)
if [[ $services_only -eq 0 ]]; then
  required_tools+=(bun)
fi
for tool in "${required_tools[@]}"; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$tool" >&2
    exit 1
  fi
done
if [[ $services_only -eq 0 && ! -e "$ui_root/node_modules/.bin/vite" ]]; then
  printf 'UI dependencies missing. Run bun install --frozen-lockfile in src/batteryland_ui.\n' >&2
  exit 1
fi

cd -- "$project_root"
data_dir="${BATTERYLAND_DATA_DIR:-var}"
[[ $data_dir == /* ]] || data_dir="$project_root/$data_dir"
export BATTERYLAND_DATA_DIR="$data_dir"
export BATTERYLAND_TRAINING_PYTHON="${BATTERYLAND_TRAINING_PYTHON:-$project_root/.venv-training/bin/python}"
export VITE_PROXY_TARGET="http://127.0.0.1:$backend_port"
mkdir -p "$data_dir"
for setting in BATTERYLAND_VALIDATION_SECRET BATTERYLAND_SERVICE_TOKEN; do
  if [[ -z ${!setting:-} ]]; then
    case "$setting" in
      BATTERYLAND_VALIDATION_SECRET) secret_file="$data_dir/.validation-secret" ;;
      BATTERYLAND_SERVICE_TOKEN) secret_file="$data_dir/.service-token" ;;
    esac
    if [[ ! -s "$secret_file" ]]; then
      (umask 077; od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > "$secret_file")
    fi
    export "$setting=$(cat "$secret_file")"
  fi
done

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
if [[ $services_only -eq 0 ]]; then
  (
    cd -- "$ui_root"
    exec setsid bun run dev -- --host 0.0.0.0 --port "$ui_port" --strictPort
  ) &
  pids+=("$!")
fi

printf 'API: http://127.0.0.1:%s/docs\n' "$backend_port"
if [[ $services_only -eq 0 ]]; then
  printf 'UI: http://127.0.0.1:%s\n' "$ui_port"
fi
printf 'Ctrl+C stops all services.\n'
status=0
wait -n "${pids[@]}" || status=$?
exit "$status"
