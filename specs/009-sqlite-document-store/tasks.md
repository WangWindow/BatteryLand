# Tasks: SQLite JSON 文档存储

**Status**: Merged to local `main`; existing API tests remain blocked by the installed TestClient stack.

- [x] T001 [US1] Add SQLite repository tests for JSON document round-trip, immutable identity, invalid finite JSON, reference validation, and transactional rollback in `tests/integration/test_storage.py`; establish failing behavior before implementation.
- [x] T002 [US2] Add legacy JSON migration tests for complete import, metadata/checksum mismatch, idempotent retry, incomplete rows, and recoverable backup behavior.
- [x] T003 [US1] Add nullable JSON payload column using Alembic revision `0002` and update the SQLAlchemy model.
- [x] T004 [US1] Implement transactional publish/read/import and validation in `SqlDocumentRepository`; make `add` idempotently verify documents published by the adapter.
- [x] T005 [US2] Implement `SQLiteDocumentStore` and safe, restartable legacy directory migration; wire it into application startup after schema initialization.
- [x] T006 [US1] Run storage and unit tests, `ty check`, Ruff checks, and formatting; inspect migration and final diff.
- [ ] T007 Run the existing API integration suite after resolving the current TestClient environment hang.
- [x] T008 Commit specification/constitution separately from code; commit the implementation, fast-forward merge the completed feature into local `main`, and remove the feature branch.

## Verification

- Storage and unit tests: 27 passed, including configuration persistence across backend restart and automatic migration at container startup.
- `ty check`: passed.
- Ruff lint and format checks: passed.
- The full suite cannot currently reach application tests: even `TestClient(FastAPI())` hangs before entering its context under FastAPI 0.161.1, Starlette 1.9.0, AnyIO 4.15.1 and httpx 0.28.1. Starlette emits a warning that this test-client setup is deprecated. Storage tests and a direct `Container` restart test run successfully without TestClient.
