# Implementation Plan: 数据来源浏览与电池导入

**Branch**: `010-data-source-browser` | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md)

## Summary

扩展现有资源服务，提供受控来源文件发现与批量登记；将来源 alias 选项变为可读的目录名和候选文件计数，并重做资源页的来源层级，让来源卡片和文件选择成为清晰的主流程。保留 JSON 清单作为高级补充元数据入口。

## Technical Context

- **Backend**: Python 3.14, FastAPI, SQLAlchemy 2.x/SQLite
- **Frontend**: React 19, TypeScript, shadcn/ui, Tailwind CSS 4, i18next
- **Testing**: pytest for source scanning and resource service; Vitest/Testing Library for resource UI; ty, Ruff, Biome, TypeScript and Vite build
- **Constraints**: Only scan configured root aliases; never expose or accept arbitrary server paths; preserve current battery IDs and Deeplatform relative-key contract.

## Design

- Extend `SourceFiles` with a constrained discovery operation. `LocalSourceFiles` scans root-level and one-level-deep `.pkl` files without following symlinks and returns pagination metadata.
- Extend source options with a safe display label and discovery count. Source list responses add the current count from the configured root while preserving existing fields.
- Add `ResourceService.list_source_files` to resolve a registered source before scanning, and keep `import_batteries` as the single idempotent database write path.
- Add a typed API endpoint for source file discovery. File import requests continue through the existing batch-import route with server-validated relative keys.
- Rework `ResourcesPage`: source cards are visible above the battery browser; registering a source uses configured directory options; a file picker supports search, pagination, selection retention, and a clear import action; JSON manifest import moves to an advanced section.
- Do not parse pickle files during browsing or copy them into a second location. Keep source paths inside the infrastructure adapter.

## Constitution Check

- FastAPI remains an API-only boundary and React remains a separate client: pass.
- Configured data root is the only accessible filesystem boundary; API exposes no absolute path: required and covered by tests.
- Relational data continues through SQLAlchemy ORM and application repositories: pass.
- Source discovery avoids reading pickle content or loading training libraries: pass.
- Feature tests establish safe scan, duplicate handling, pagination, and UI selection behavior: required before implementation.

## Scope

```text
specs/010-data-source-browser/{spec.md,plan.md,tasks.md}
src/batteryland/application/ports/files.py
src/batteryland/application/resources.py
src/batteryland/infrastructure/files.py
src/batteryland/interfaces/api/resources.py
src/batteryland_ui/src/api/{models.ts,endpoints.ts,types.ts}
src/batteryland_ui/src/pages/resources-page.tsx
src/batteryland_ui/src/i18n/messages/resources.ts
tests/{unit,integration}/
src/batteryland_ui/tests/
```
