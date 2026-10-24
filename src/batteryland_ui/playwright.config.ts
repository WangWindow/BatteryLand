import { defineConfig, devices } from "@playwright/test"

const backendPort = process.env.E2E_BACKEND_PORT ?? "8010"
const frontendPort = process.env.E2E_FRONTEND_PORT ?? "5173"
const frontendUrl = `http://127.0.0.1:${frontendPort}`
const backendUrl = `http://127.0.0.1:${backendPort}`

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? frontendUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: "bash tests/e2e_stack.sh",
          cwd: "../..",
          url: `${backendUrl}/openapi.json`,
          env: { E2E_BACKEND_PORT: backendPort },
          reuseExistingServer: false,
          timeout: 180_000,
        },
        {
          command: `bun run dev -- --host 127.0.0.1 --port ${frontendPort} --strictPort`,
          url: frontendUrl,
          env: { VITE_PROXY_TARGET: backendUrl },
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ],
})
