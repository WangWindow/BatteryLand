# BatteryLand UI

React application for the BatteryLand FastAPI service. It uses GitHub Primer React for interface components and design tokens, React Router for navigation, TanStack Query for API state, and ECharts for charts.

```sh
bun install --frozen-lockfile
bun run dev
```

Vite proxies `/api` to `http://127.0.0.1:8000`. Set `VITE_PROXY_TARGET` to change the backend address. Regenerate API types after changing the OpenAPI contract with `bun run generate:api`.

Run `bun run verify` for type checks, formatting, unit tests, and a production build. Run `bun run test:e2e:workbench` for the browser workflow against the versioned API contract fixtures.
