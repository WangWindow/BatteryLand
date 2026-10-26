# Quickstart: Online Artifact Preview

## Prerequisites

- Install the Python dependencies with `uv sync`.
- Install UI dependencies with `cd src/batteryland_ui && bun install`.
- Ensure at least one completed experiment has available text and model artifacts.

## Run locally

From the repository root, run `./scripts/run.sh`. The UI uses its existing development proxy to reach the FastAPI service.

## Manual validation

1. Open an experiment detail page with a `.log`, `.yaml`, or `.json` artifact. Confirm an eye action appears beside Download.
2. Open the artifact. Confirm GitHub-themed syntax display, scrolling, and selection work while typing and pasting cannot change its content. Close the dialog and confirm the detail page is retained.
3. Open a supported model artifact such as `.safetensors` or `.onnx`. Confirm the embedded viewer shows model structure and the artifact remains downloadable.
4. Open the configuration editor. Confirm YAML remains editable and its existing validation/save controls still work. Open a saved experiment detail page and confirm the stored YAML and split manifest are read-only.
5. Confirm a directory artifact and unsupported suffix have no preview action; download remains available for registered files.
6. Run an experiment where the best result changes during training. After the process exits, confirm the state changes to a terminal state and the displayed result matches the final output file.
7. Open component registration details, validation split JSON, and analysis statistics. Confirm each is indented, syntax-highlighted, and read-only; editable JSON component parameters retain incomplete text while being edited.

## Static verification

From the repository root:

```sh
uv run ruff check src/batteryland/components/routes.py src/batteryland/components/service.py
uv run ruff format --check src/batteryland/components/routes.py src/batteryland/components/service.py
uv run ty check
cd src/batteryland_ui
bun run typecheck
bun run build
```
