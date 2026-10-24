# Implementation Plan: SQLite JSON 文档存储

**Branch**: `009-sqlite-document-store` | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md)

## Summary

保留应用层 `DocumentStore` 契约，改用 SQLite JSON 字段作为文档仓储的唯一活动实现。通过 Alembic 为既有 `document_versions` 增加可回填 JSON 字段；启动时校验并幂等导入旧 JSON 文档，完整迁移后将旧目录原子改名为可恢复备份。

## Technical Context

- **Language/Version**: Python 3.14
- **Primary Dependencies**: SQLAlchemy 2.x, Alembic, pytest
- **Storage**: SQLite JSON column; historical JSON files are migration inputs only
- **Testing**: pytest with temporary SQLite databases and temporary document directories; ty type check
- **Constraints**: Keep HTTP and Deeplatform contracts stable; preserve DDD dependency direction; no Redis or MongoDB runtime requirement.

## Design

- Add a nullable `payload` JSON column using a forward-only Alembic migration. It remains nullable at the schema level to support a safe, restartable import of existing rows; repository writes enforce non-null JSON payloads.
- Extend `SqlDocumentRepository` to publish and read immutable JSON envelopes inside transactions, validate finite JSON and content hashes, and import legacy envelopes idempotently. `storage_key` becomes opaque (`sqlite:<document-id>`) for new and migrated documents.
- Replace `JsonDocumentStore` with a `SQLiteDocumentStore` adapter that opens repository units of work and retains a reentrant publication lock for existing service call sites.
- On startup after schema upgrade, import all legacy `documents/*.json` files. Validate UUID filenames and envelope/ref metadata; only after all imports and null-payload checks pass rename the directory to `documents.legacy` or a unique timestamped sibling.
- Keep the old JSON implementation out of active application composition. Preserve original document bytes unchanged in the backup.

## Constitution Check

- SQLite + SQLAlchemy is the single active relational/document store; no database service added: pass.
- Document payload and immutable metadata are committed in one database transaction: pass.
- Historical migration is repeatable, validates identities and checksums, and preserves a recoverable source: required by tests before implementation.
- Application-facing document and API contracts remain unchanged; infrastructure contains SQLAlchemy details: pass.
- Tests use temporary SQLite and files; no Redis, MongoDB, GPU, or external service: pass.

## Scope

```text
.specify/memory/constitution.md
specs/009-sqlite-document-store/{spec.md,plan.md,tasks.md}
src/batteryland/infrastructure/persistence/models.py
src/batteryland/infrastructure/persistence/migrations/versions/0002_sqlite_document_payload.py
src/batteryland/infrastructure/persistence/documents.py
src/batteryland/infrastructure/documents.py
src/batteryland/bootstrap.py
tests/integration/test_storage.py
```
