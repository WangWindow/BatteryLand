# Implementation Plan: 工作台导航与设置菜单

**Branch**: `008-workbench-shell` | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md)

## Summary

修复共享查询 Hook 的轮询生命周期：保留成功数据，并在每次响应结束后安排下一次轮询。调整 AppShell，将语言和主题收进可访问设置菜单，提供可展开的导航分组，并补齐浅色/深色语义变量。

## Technical Context

- **Language/Version**: TypeScript, React 19
- **Primary Dependencies**: React, Radix DropdownMenu through shadcn, i18next, Tailwind CSS 4
- **Storage**: Browser localStorage for appearance and existing language preference
- **Testing**: Vitest + Testing Library, Biome, i18n check, TypeScript, Vite build
- **Target Platform**: Browser, desktop sidebar and mobile top navigation
- **Constraints**: Keep API contracts and route ownership unchanged; preserve frontend/backend separation.

## Design

- `useApiQuery` owns a single request lifecycle and schedules the next poll only after success or failure settles. Dependency changes, explicit refresh, and unmount abort the active request. Polling defaults to retaining previous data.
- Add a focused appearance preference hook/component that persists `light`, `dark`, or `system` and applies the document class. The settings menu composes language and appearance radio submenus.
- Navigation groups use semantic buttons with `aria-expanded` and controlled child lists. Desktop groups are collapsible; mobile stays flattened.
- Remove the textual workbench identity from the desktop header. Keep a compact brand mark beside the sidebar toggle and put a settings trigger in the footer.
- Add dark semantic CSS variables and strengthen secondary text contrast without hard-coded per-component colors.

## Constitution Check

- Frontend remains a separate React application communicating through the existing API client: pass.
- Reuses installed UI, i18n, routing, and testing dependencies: pass.
- Required user behavior is covered by focused UI/hook tests before implementation: pass.
- No API or database changes in this feature: pass.

## Scope

```text
src/batteryland_ui/src/hooks/use-api-query.ts
src/batteryland_ui/src/components/app-shell.tsx
src/batteryland_ui/src/components/settings-menu.tsx
src/batteryland_ui/src/components/appearance.ts
src/batteryland_ui/src/index.css
src/batteryland_ui/src/main.tsx
src/batteryland_ui/src/i18n/messages/common.ts
src/batteryland_ui/tests/use-api-query.test.tsx
src/batteryland_ui/tests/app-shell.test.tsx
```

The previous standalone `language-switcher.tsx` was removed after its desktop/mobile use moved into `SettingsMenu`.
