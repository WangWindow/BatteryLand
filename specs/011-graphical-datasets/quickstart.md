# Quickstart: 图形化数据集创建与划分

## Prerequisites

- Configure at least one source through `BATTERYLAND_SOURCE_ROOTS` and register it in the Data Sources page.
- Register a few battery records with scalar metadata; include a parent/child pair to verify family grouping.
- Run the API and UI with `scripts/run.sh` from the repository root.

## Validate the backend workflow

```sh
.venv/bin/pytest tests/unit/test_dataset_statistics.py tests/unit/test_splits.py tests/contract/test_api.py -q
.venv/bin/ty check
.venv/bin/ruff check src/batteryland tests/unit/test_dataset_statistics.py tests/unit/test_splits.py
.venv/bin/ruff format --check src/batteryland tests/unit/test_dataset_statistics.py tests/unit/test_splits.py
```

Expected outcomes:

- A whole-source or selected-member preview returns exact counts from the server partition algorithm.
- A save using a changed source revision is rejected; an unchanged preview can be saved.
- Related battery family members never appear in different partitions.
- Split detail returns a profile for the exact requested document version; missing metadata is reported as missing and unsupported nested values are reported separately.

## Validate the browser workflow

```sh
cd src/batteryland_ui
bun run test -- tests/splits-page.test.tsx
bun run typecheck
bun run check
bun run build
```

Expected outcomes:

- The user can select a named source card, choose all or selected batteries, preview the three partition counts, and save without entering paths or UUIDs.
- Search and pagination do not clear selections. Invalid ratios or a stale preview disable save and show a localized explanation.
- Editing an existing split creates a new version; reading the previous version returns its original members and summary.

Detailed request, response, and profile shapes are in [contracts/datasets.yaml](contracts/datasets.yaml); entity identity and validation are in [data-model.md](data-model.md).
