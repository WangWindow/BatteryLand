# BatteryLand Workbench UI

Simplified but real frontend for BatteryLand. It communicates with the backend
engine only through the versioned `/api/v1` HTTP contract, and never reads
SQLite, JSON documents, run directories, or provider internals.

## Responsibilities

- `src/api/`: generated OpenAPI DTOs, one fetch client, endpoint functions.
- `src/pages/`: resource, split, template, component, experiment, queue,
  detail, and comparison workflows.
- `src/visualizer/`: chart transforms and browser rendering. The comparison page
  loads it with `React.lazy`, so ordinary pages never request the chart chunk.
- `src/i18n/`: simplified Chinese and English catalogs and language state.
- `src/hooks/`: abortable query lifecycle and incremental log cursor polling.

The scheduler is a separate process at `src/simple_impl/scheduler`. It only uses
public queue and dispatch endpoints. Replacing scheduling policy does not require
changing the engine, database, UI, or training provider.

## Commands

```bash
bun install --frozen-lockfile
bun run dev                 # http://127.0.0.1:5173, proxies /api to :8000
bun run typecheck
bun run check               # Biome + i18n contract
bun run test                # Vitest + React Testing Library
bun run test:e2e            # real HTTP backend + controlled training + scheduler + Chromium
bun run test:e2e:real       # real deeplatform MyTask + real backend + scheduler + Chromium
bun run build
bun run verify              # typecheck + check + test + build
bun run generate:api        # regenerate src/api/types.ts from the 003 OpenAPI snapshot
```

`E2E_BACKEND_PORT` defaults to `8010`; `E2E_BASE_URL` can point Playwright at an
already running application. The E2E fixture backend uses a controlled training
subprocess only inside the test service; it is not a production capability.

## Internationalization Contract

Every user-facing string, accessible label, empty state, error, button, and chart
description must live in `src/i18n/messages/`. Each feature file declares the
Chinese tree and its English counterpart with `defineMessages`, so a missing key
or changed tree fails TypeScript compilation.

`scripts/check-i18n.ts` additionally enforces:
- identical key trees and `{{placeholder}}` sets in `zh-CN` and `en`;
- every statically referenced `t("key")` exists in both catalogs;
- no hardcoded Chinese text in source;
- no hardcoded JSX text or literal `placeholder`, `title`, `aria-label`,
  `aria-description`, `alt` values;
- `toast.*` and `set*Error`/`set*Message` calls use translations.

Add or change both languages in the same change. Technical identifiers, state
enum values, commands, UUIDs, units, and JSON field names may remain literal.
