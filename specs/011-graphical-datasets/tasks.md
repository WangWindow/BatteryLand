---
description: "Implementation tasks for graphical dataset creation and partitioning"
---

# Tasks: 图形化数据集创建与划分

**Input**: Design documents in `specs/011-graphical-datasets/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, and `contracts/datasets.yaml`

**Organization**: Tasks are grouped by user story. Each behavior starts with a failing test as required by the project TDD constitution.

## Phase 1: Setup

Existing FastAPI, SQLite, React, shadcn/ui, i18n, and test infrastructure are already configured; no new dependencies or project setup are required.

## Phase 2: Foundational

No cross-story foundation is required. The implementation reuses the current source, battery, split, and document-version boundaries.

---

## Phase 3: User Story 1 - 选择来源并创建逻辑数据集 (Priority: P1)

**Goal**: Let users select a configured source and either all registered batteries or a searched, paged subset.

**Independent Test**: Source cards show registered counts; whole-source and subset selection produce the intended membership without asking users for paths or UUIDs.

### Tests for User Story 1

- [ ] T001 [P] [US1] Add failing repository/service tests for registered battery counts and source revision changes after new imports in `tests/unit/test_resources.py`.
- [ ] T002 [P] [US1] Add failing UI tests for source-card selection, whole-source mode, paged subset selection, and selection retention in `src/batteryland_ui/tests/splits-page.test.tsx`.
- [ ] T003 [P] [US1] Update the OpenAPI contract test to require `battery_count` on source list items in `tests/contract/test_api.py`.

### Implementation for User Story 1

- [ ] T004 [US1] Add efficient per-source registered battery counts, all-source member lookup, and a revision increment on newly added records in `src/batteryland/infrastructure/persistence/resources.py`, `src/batteryland/application/ports/persistence.py`, and `src/batteryland/application/resources.py`.
- [ ] T005 [US1] Include `battery_count`, `include_all_source`, and `expected_source_revision` in request/response models in `src/batteryland/interfaces/api/resources.py` and `src/batteryland/interfaces/api/splits.py`.
- [ ] T006 [US1] Implement source cards, stable accessible accent colors, all-source/selected-member mode, and paged selection in `src/batteryland_ui/src/pages/splits-page.tsx`.
- [ ] T007 [US1] Add matching Simplified Chinese and English source/selection messages in `src/batteryland_ui/src/i18n/messages/splits.ts`.
- [ ] T008 [US1] Update source and selection response types in `src/batteryland_ui/src/api/models.ts` and regenerate `src/batteryland_ui/src/api/types.ts`.

**Checkpoint**: Source identity, counts, and whole/subset selection work independently of partition preview.

---

## Phase 4: User Story 2 - 可视化预览并保存数据划分 (Priority: P1)

**Goal**: Show exact family-aware train/validation/test counts before saving a deterministic logical dataset version.

**Independent Test**: Given a fixed source revision, selection, method, ratios, and seed, preview and saved partition counts match; a changed source revision rejects save.

### Tests for User Story 2

- [ ] T009 [P] [US2] Add failing service tests for preview counts, family grouping, deterministic seed behavior, and stale source revision rejection in `tests/unit/test_splits.py`.
- [ ] T010 [P] [US2] Add failing OpenAPI assertions for the split preview operation and source revision fields in `tests/contract/test_api.py`.
- [ ] T011 [P] [US2] Add failing UI tests for ratio validation, preview-driven counts, preview invalidation after edits, and save disabled before preview in `src/batteryland_ui/tests/splits-page.test.tsx`.

### Implementation for User Story 2

- [ ] T012 [US2] Implement `SplitService.preview` by reusing existing family-aware split validation and confirmed source revisions in `src/batteryland/application/splits.py`.
- [ ] T013 [US2] Define typed preview request/response models and `POST /api/v1/splits/preview` in `src/batteryland/interfaces/api/splits.py`.
- [ ] T014 [US2] Add the right-side editor, accessible ratio sliders, explicit preview state, partition count visualization, and localized conflict/error states in `src/batteryland_ui/src/pages/splits-page.tsx`.
- [ ] T015 [US2] Generate OpenAPI/TypeScript contracts and matching Chinese/English preview messages in `specs/004-integrated-workbench/contracts/openapi.json`, `src/batteryland_ui/src/api/types.ts`, and `src/batteryland_ui/src/i18n/messages/splits.ts`.

**Checkpoint**: Users can preview and save family-safe partitions without front-end algorithm estimates.

---

## Phase 5: User Story 3 - 为数据集版本保存可比较的统计摘要 (Priority: P2)

**Goal**: Persist whole-set and per-partition metadata summaries with the exact immutable split version.

**Independent Test**: Fixed records produce exact typed category and numeric summaries for the whole set and each partition; detail reads preserve old-version summaries after a later edit and application restart.

### Tests for User Story 3

- [ ] T016 [P] [US3] Add failing pure-function tests for numeric, categorical, missing, unsupported, empty, and mixed scalar metadata in `tests/unit/test_dataset_statistics.py`.
- [ ] T017 [P] [US3] Add failing SQLite tests for profile/document-version identity, atomic split/member/profile persistence, and legacy-profile backfill in `tests/unit/test_split_statistics.py`.
- [ ] T018 [P] [US3] Add failing service/API contract tests for statistics in current and historical split detail responses in `tests/unit/test_splits.py` and `tests/contract/test_api.py`.

### Implementation for User Story 3

- [ ] T019 [US3] Implement pure metadata aggregation for full-set and partition scopes in `src/batteryland/domain/dataset_statistics.py`.
- [ ] T020 [US3] Add the version-keyed statistics ORM mapping and Alembic migration in `src/batteryland/infrastructure/persistence/models.py` and `src/batteryland/infrastructure/persistence/migrations/versions/0003_dataset_statistics.py`.
- [ ] T021 [US3] Add repository profile read/write methods and persist profile rows with split members in `src/batteryland/application/ports/persistence.py`, `src/batteryland/infrastructure/persistence/splits.py`, and `src/batteryland/infrastructure/persistence/unit_of_work.py`.
- [ ] T022 [US3] Compute profiles on create/update and backfill older immutable versions on detail reads in `src/batteryland/application/splits.py`.
- [ ] T023 [US3] Add typed statistics scopes and attributes to split detail responses in `src/batteryland/interfaces/api/splits.py`.
- [ ] T024 [US3] Regenerate and verify the reviewed OpenAPI contract and TypeScript types in `specs/004-integrated-workbench/contracts/openapi.json` and `src/batteryland_ui/src/api/types.ts`.

**Checkpoint**: New and historical split versions return stable statistics profiles from SQLite.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Confirm contracts, accessibility, localization, migrations, and feature acceptance.

- [ ] T025 Run the feature backend suites, `ty`, Ruff lint/format, UI interaction tests, TypeScript, Biome/i18n, and production build; record results in `specs/011-graphical-datasets/tasks.md`.
- [ ] T026 Validate the source-to-preview-to-save workflow and profile persistence scenarios in `specs/011-graphical-datasets/quickstart.md`.
- [ ] T027 Review the final feature diff and ensure generated OpenAPI, TypeScript types, and bilingual messages match in `specs/004-integrated-workbench/contracts/openapi.json` and `src/batteryland_ui/src/`.

## Dependencies & Execution Order

### Phase Dependencies

- Setup and foundational prerequisites are already present.
- User Story 1 precedes User Story 2 because preview relies on source revisions and source-scoped selection.
- User Story 3 follows User Story 2 because profile creation is tied to split document versions.
- Polish starts after all three stories pass their independent acceptance checks.

### User Story Dependencies

- **US1 (P1)**: Can start immediately; establishes source counts and all/subset selection.
- **US2 (P1)**: Depends on source selection and revision contract from US1.
- **US3 (P2)**: Depends on saved versioned split memberships from US2.

### Within Each User Story

- Write and run tests first; verify they fail because expected behavior is missing.
- Implement domain behavior before application/repository/API wiring where applicable.
- Complete the server contract before wiring the page to it.
- Run each story's independent tests before moving to the next story.

### Parallel Opportunities

- UI test scaffolding and backend tests can be authored independently within each story.
- Domain aggregation tests and statistics repository tests use separate files and can be developed independently before service wiring.
- User stories themselves are sequential because each builds on the previous workflow state.

## Implementation Strategy

### MVP First

1. Complete US1 source cards and whole/subset selection.
2. Complete US2 server preview and save workflow; validate the source-to-split journey.
3. Complete US3 versioned statistics; validate missing data and old-version stability.

### Incremental Delivery

- Deliver source selection before preview so it can be verified independently.
- Deliver preview and save before statistics so split membership remains independently useful.
- Deliver profiles as a separate, testable increment that prepares the next comparison feature.
- Keep each change behind the current public API, with OpenAPI and generated types synchronized.
