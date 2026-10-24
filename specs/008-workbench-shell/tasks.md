# Tasks: 工作台导航与设置菜单

**Status**: Complete; merged to local `main`

- [x] T001 [US1] Add pending-request polling regressions in `src/batteryland_ui/tests/use-api-query.test.tsx`; confirm overlap and data clearing before the fix.
- [x] T002 [US1] Serialize polling and retain previous data in `src/batteryland_ui/src/hooks/use-api-query.ts`.
- [x] T003 [US2] Add menu interaction, language/theme persistence, and system appearance coverage in `src/batteryland_ui/tests/app-shell.test.tsx`.
- [x] T004 [US2] Implement persistent appearance selection and language/theme menu in `src/batteryland_ui/src/components/appearance.ts` and `src/batteryland_ui/src/components/settings-menu.tsx`.
- [x] T005 [US2] Add bilingual setting labels and dark semantic tokens in `src/batteryland_ui/src/i18n/messages/common.ts` and `src/batteryland_ui/src/index.css`.
- [x] T006 [US3] Rework the sidebar header/footer and collapsible navigation groups in `src/batteryland_ui/src/components/app-shell.tsx`.
- [x] T007 Run relevant frontend tests, Biome/i18n, TypeScript, and production build; review the final diff.
- [x] T008 Commit the docs separately from the UI implementation, fast-forward merge the completed feature into local `main`, and remove the feature branch.

## Verification

- The new polling tests failed before the fix because a slow request was restarted and successful queue data was cleared; all three polling cases pass after the fix.
- `bun run test`: 34 passed across 10 files.
- `bun run check`: Biome passed; i18n passed with 599 matching keys in `zh-CN` and `en`.
- `bun run typecheck` and `bun run build` passed.
- `git diff --check` passed; the `deeplatform` submodule is unchanged.
