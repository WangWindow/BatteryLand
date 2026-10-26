# Tasks: Online Artifact Preview

**Input**: Design documents from `/specs/013-artifact-preview/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, and `contracts/artifact-preview.md`

## Phase 1: Read-only artifact preview

**Goal**: Let users inspect supported artifacts from experiment details without changing the stored output.

- [x] T001 [US1] Add bounded text preview validation and model format validation in `src/batteryland/components/service.py`.
- [x] T002 [US1] Add text preview, model document, model data, and same-origin Netron asset routes in `src/batteryland/components/routes.py`.
- [x] T003 [US3] Add Netron as a backend dependency and lock it in `pyproject.toml` and `uv.lock`.
- [x] T004 [US1] Add a typed text API client in `src/batteryland_ui/src/api/client.ts`.
- [x] T005 [US1] Add eye actions, read-only text previews, and embedded model viewer to `src/batteryland_ui/src/pages/experiment-detail.tsx`.

## Phase 2: GitHub-themed configuration and input viewer

**Goal**: Reuse one editor presentation with editing available only for the active configuration workflow.

- [x] T006 [US4] Add the GitHub-themed YAML/JSON editor wrapper in `src/batteryland_ui/src/components/code-editor.tsx` and its dependencies in `src/batteryland_ui/package.json` and `src/batteryland_ui/bun.lock`.
- [x] T007 [US4] Replace the YAML textarea in `src/batteryland_ui/src/pages/experiment-editor.tsx` with the editable code editor.
- [x] T008 [US4] Show saved experiment configuration and split manifest using read-only editor mode in `src/batteryland_ui/src/pages/experiment-detail.tsx`.
- [x] T009 [US1] Add editor, preview frame, and modal footer styling in `src/batteryland_ui/src/styles.css` and `src/batteryland_ui/src/components/common.tsx`.

## Phase 3: Contract and verification

**Goal**: Keep generated API types and feature documentation aligned with the implementation.

- [x] T010 [US1] Regenerate `specs/012-backend-service-protocol/contracts/core-openapi.json` and `src/batteryland_ui/src/api/schema.ts` for the preview API.
- [x] T011 [US1] Document preview limits, format policy, and manual validation steps in `specs/013-artifact-preview/`.
- [x] T012 [US1] Run Ruff, ty, Biome, TypeScript, OpenAPI synchronization, and frontend production-build checks.

## Phase 4: Final result and JSON detail consistency

**Goal**: Record experiment completion even when result files change during training, and make JSON previews consistent across the UI.

- [x] T013 [US2] Collect final results only after process exit and isolate output collection errors from terminal-state updates in `src/batteryland/scheduler/service.py`.
- [x] T014 [US2] Allow active result snapshots to be replaced by the next immutable result version in `src/batteryland/results/service.py`.
- [x] T015 [US2] Add a changing intermediate/final result regression scenario in `tests/integration/test_local_workflow.py`.
- [x] T016 [US2] Pretty-format JSON in the shared editor and replace JSON preview blocks in `src/batteryland_ui/src/components/config-editor.tsx`, `src/batteryland_ui/src/pages/components.tsx`, `src/batteryland_ui/src/pages/experiment-editor.tsx`, and `src/batteryland_ui/src/pages/dataset-analysis.tsx`.
- [x] T017 [US2] Add and run a focused scheduler regression test in `tests/unit/test_scheduler_result_handling.py`.
- [ ] T018 [US2] Run the HTTP integration test in `tests/integration/test_local_workflow.py` after the environment's `TestClient` startup hang is resolved.

## Dependencies

- T001–T003 precede model and text preview UI tasks T004–T005.
- T006 precedes T007–T009 and T016.
- T013–T015 cover the final-result lifecycle; T016 updates JSON presentations.
- T010–T012 and T017–T018 are verification/documentation tasks.

## Completion

- Text artifacts are bounded and read-only; common model formats open in the locally served viewer.
- Configuration remains editable only in its existing workflow; saved experiment inputs remain read-only.
- Static checks, production build, and the focused scheduler unit regression pass. The HTTP integration regression remains unverified because `TestClient` startup hangs in this environment.
