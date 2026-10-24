# Tasks: 数据来源浏览与电池导入

**Status**: Complete

- [x] T001 [US2] Add failing tests for configured-root discovery, search/paging, file type filtering, symlink/path containment, and duplicate basenames.
- [x] T002 [US1] Add ResourceService coverage and API contract coverage for source counts and source-scoped discovery.
- [x] T003 [US2] Implement safe file discovery in `SourceFiles`/`LocalSourceFiles` and source-scoped resource service paging.
- [x] T004 [US2] Add typed FastAPI discovery endpoint and preserve current import response semantics.
- [x] T005 [US1] Build the source cards and multi-page file selector in `ResourcesPage`; show the configured directory identity and move manifest import to advanced actions.
- [x] T006 [US1] Add bilingual messages, accessibility, and focused UI interaction coverage.
- [x] T007 Run backend/frontend checks, update generated OpenAPI TypeScript types, and review the final diff.

## Verification

- Backend source-discovery and API-contract tests: `6 passed`.
- Python checks: `ty check`, Ruff lint, and Ruff format check passed.
- Frontend tests: `36 passed`; TypeScript, Biome/i18n, and production build passed.
- `git diff --check` passed.
