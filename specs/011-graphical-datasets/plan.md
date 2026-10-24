# Implementation Plan: 图形化数据集创建与划分

**Branch**: `011-graphical-datasets` | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification for graphical source/battery selection, family-aware split preview, and versioned metadata summaries.

## Summary

Reuse registered data sources as default datasets and immutable split-document versions as logical datasets. Add a backend preview operation that reuses the existing family-aware partition algorithm, exposes a registered battery count, and rejects stale previews using the source revision. Compute metadata summaries for the complete logical set and each partition; persist them as a SQLite projection keyed by split document ID. Rework the split editor into a restrained right-side workflow with source cards, paginated battery selection, partition visualization, and explicit preview/save steps.

## Technical Context

- **Language/Version**: Python 3.14; TypeScript 6 and React 19
- **Primary Dependencies**: FastAPI, Pydantic, SQLAlchemy 2, Alembic, React, shadcn/ui, Tailwind CSS 4
- **Storage**: SQLite through SQLAlchemy ORM; JSON summary projection keyed to immutable split document versions
- **Testing**: pytest, Vitest/React Testing Library, OpenAPI contract tests, `ty`, Ruff, Biome, TypeScript, Vite build
- **Target Platform**: Local or single-host FastAPI service and independently served browser UI
- **Project Type**: Separated web client and API service
- **Performance Goals**: Source cards use one paged source query with counts; battery search stays paged; preview and summary work only on the requested source selection and never inspect raw files.
- **Constraints**: Preserve train/validation/test family isolation, versioned split identity, explicit seed behavior, and experiment references. Do not add Redis, MongoDB, a second Python runtime, or a new dataset entity. Do not load pickle files or Deeplatform in statistics paths.
- **Scale/Scope**: One registered source per logical dataset, up to the registered batteries belonging to that source; summaries cover all members and each of the three partitions.

## Constitution Check

- **Frontend/backend ownership**: Pass. React calls typed FastAPI endpoints; server owns selection resolution, family validation, preview results, and summaries.
- **DDD boundaries**: Pass. Pure partition/statistics rules remain in domain functions; application services coordinate; repositories own SQLAlchemy persistence; routers map typed requests and responses.
- **Persistence**: Pass. Data sources, revisions, split members, documents, and statistics all remain in SQLite. No Redis, MongoDB, or JSON-file active database.
- **Stable contracts**: Pass. Update OpenAPI, generated TypeScript types, and contract tests for new response/request fields.
- **Training ownership**: Pass. Statistics read registered battery metadata only and do not modify `deeplatform` or load its runtime.
- **UI principles**: Pass. Stable source color accents retain text labels; partitions use color plus explicit names; the right-side editor has accessible controls and clear empty/error/loading states.
- **TDD**: Pass. Add domain, repository/service, API-contract, and UI interaction tests first; run failing tests before implementation.
- **Scope**: Pass. Comparison charts, component marketplace, experiment property editor, and scheduler resource monitoring remain subsequent features.

## Design

### Backend

1. Add a source battery count to the paginated source query so source selection cards need no per-source API fan-out.
2. Increment source revision only when new battery rows are registered.
3. Add an explicit `include_all_source` selection mode and expected source revision to split preview/create/update. The whole-source mode resolves membership server-side; selected mode keeps explicit battery IDs. Manual and hybrid member assignment remains limited to an explicit selection in the first UI iteration; whole-source mode defaults to random partitioning.
4. Add `SplitService.preview`, reusing the same payload validation and `make_split` logic as create/update. Return exact counts and source revision. Reject a changed source revision on save.
5. Add a pure statistics function. For every field seen in a partition, distinguish missing and unsupported values; aggregate finite numeric scalars as count/min/max/mean, and other scalar values as typed categories/counts.
6. Add a `DatasetStatisticsRow` projection keyed by `document_id`. Create/update persists it alongside the split header and member projection in the same unit of work. For older versions without a profile, compute and persist a profile on first detail read without changing the immutable document payload.
7. Return statistics in split detail responses, not list pages, to preserve lightweight list queries.

### Frontend

1. Retain the split list, history, export, and delete flows.
2. Replace the large create/edit modal with a right-side editor. Select a source using stable-accent cards showing name, registered battery count, and status.
3. Offer whole-source or paginated explicit selection; maintain selected members when search/page changes.
4. Use keyboard-accessible ratio sliders and labeled percentage summaries. Manual and hybrid assignment controls retain explicit train/validation/test text labels.
5. Require a successful preview for current form state before enabling save. Display exact server partition counts; invalidate the preview whenever any input changes.
6. Add bilingual text and focused UI tests for source selection, whole/partial selection, pagination retention, preview, stale source conflicts, and save/version behavior.

### API Contracts

- `GET /api/v1/data-sources`: add `battery_count` to each source.
- `POST /api/v1/splits/preview`: accept a split selection/method/ratio/seed and return source revision plus exact train/val/test counts.
- `POST /api/v1/splits` and `PUT /api/v1/splits/{id}`: accept whole-source mode and the source revision confirmed by preview.
- `GET /api/v1/splits/{id}?version=...`: include the statistics profile for the requested immutable version.

Full request and response shapes are in [contracts/datasets.yaml](contracts/datasets.yaml). Statistics and persistence identities are in [data-model.md](data-model.md).

## Constitution Check (Post-Design)

- No new dataset entity duplicates versioned splits; no module ownership boundary is crossed.
- Preview and summary use only registered relational records; external filesystem data remains behind the source adapter.
- The statistics projection is rebuildable and has a direct version key; the document payload remains immutable and SQLite remains the only active store.
- The browser does not implement the partition algorithm or read local/server files.
- Each user story can be verified independently using fixed metadata fixtures and the API/UI contracts.

## Project Structure

### Documentation (this feature)

```text
specs/011-graphical-datasets/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/datasets.yaml
├── checklists/requirements.md
└── tasks.md
```

### Source Code

```text
src/batteryland/domain/dataset_statistics.py
src/batteryland/application/splits.py
src/batteryland/application/ports/persistence.py
src/batteryland/infrastructure/persistence/models.py
src/batteryland/infrastructure/persistence/migrations/versions/0003_dataset_statistics.py
src/batteryland/infrastructure/persistence/resources.py
src/batteryland/infrastructure/persistence/splits.py
src/batteryland/interfaces/api/resources.py
src/batteryland/interfaces/api/splits.py
src/batteryland_ui/src/pages/splits-page.tsx
src/batteryland_ui/src/api/{models.ts,endpoints.ts,types.ts}
src/batteryland_ui/src/i18n/messages/splits.ts
tests/unit/test_dataset_statistics.py
tests/unit/test_splits.py
tests/integration/test_splits_api.py
tests/contract/test_api.py
src/batteryland_ui/tests/splits-page.test.tsx
```

**Structure Decision**: Keep the existing separated UI/API structure and extend the split aggregate and its persistence projection. No new application project or external service is introduced.
