# Implementation Plan: Online Artifact Preview

**Branch**: `013-artifact-preview` | **Date**: 2026-10-26 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/013-artifact-preview/spec.md`

## Summary

Add in-place read-only previews for supported experiment artifacts. Text outputs use a size-limited GitHub-themed code viewer; model files use Netron assets served by the existing API process and local artifact route. The existing YAML configuration workflow adopts the same editor in editable mode, while saved experiment YAML and JSON detail views use it read-only. Final result import occurs after process exit so changing intermediate results cannot block the scheduler's terminal-state update.

## Technical Context

**Language/Version**: Python 3.14, TypeScript 5.9

**Primary Dependencies**: FastAPI, Netron 9.x, CodeMirror 6 with GitHub theme, React 19

**Storage**: Existing artifact files and SQLite metadata; no schema changes

**Testing**: Regression coverage for changing intermediate/final training results, plus Ruff, ty, Biome, TypeScript, and Vite production build.

**Target Platform**: Local BatteryLand browser and API deployment

**Project Type**: Separated React frontend and FastAPI backend

**Performance Goals**: Text preview reads at most 1 MiB; model files are read by the local API for the embedded viewer.

**Constraints**: No additional service or port; explicit preview format allowlists; artifact output cannot be edited; model data must stay within the local application.

**Scale/Scope**: Experiment artifact detail, configuration editor, and saved experiment configuration/split display.

## Constitution Check

The change preserves the frontend/backend boundary. FastAPI resolves registered artifact IDs and validates formats; the React UI only presents preview actions and content. The Netron viewer and model data are served from the same API origin, so no service or port is added. Artifact previews are read-only and add no persisted artifact state or schema changes. Updated final result snapshots use the existing immutable document-version model. The OpenAPI contract and generated TypeScript API schema are synchronized. Static analysis, focused scheduler regression tests, and the frontend build are verification gates.

## Project Structure

### Documentation

```text
specs/013-artifact-preview/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/artifact-preview.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code

```text
src/batteryland/components/
├── routes.py                # preview endpoints and same-origin Netron assets
└── service.py               # artifact format and bounded text validation
src/batteryland/results/service.py
src/batteryland/scheduler/service.py
src/batteryland_ui/src/
├── components/code-editor.tsx
├── pages/experiment-detail.tsx
├── pages/experiment-editor.tsx
├── pages/components.tsx
├── pages/dataset-analysis.tsx
└── styles.css
tests/unit/test_scheduler_result_handling.py
tests/integration/test_local_workflow.py
specs/012-backend-service-protocol/contracts/core-openapi.json
```

**Structure Decision**: Extend the existing components/artifacts API and experiment detail/editor pages. Keep the preview service inside the main FastAPI process and avoid a model-viewer service.

## Delivery Phases

1. Add bounded preview validation, model format validation, and same-origin preview routes.
2. Add the shared GitHub-themed editor and apply explicit editable/read-only modes to configuration, saved experiment inputs, artifact previews, and other JSON detail views.
3. Defer final result import until process exit, make intermediate result snapshots replaceable while active, and ensure output collection errors do not block terminal-state recording.
4. Regenerate the public OpenAPI contract and TypeScript schema; record manual validation guidance and run the available static/build checks.

## Complexity Tracking

No Constitution violations identified. No database migration, new service, or cross-process contract is introduced.
