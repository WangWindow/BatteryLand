import { defineConfig, devices } from "@playwright/test"

const backendPort = process.env.E2E_BACKEND_PORT ?? "8010"
const backendUrl = `http://127.0.0.1:${backendPort}`

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
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
          url: `${backendUrl}/api/v1/capabilities`,
          env: { E2E_BACKEND_PORT: backendPort },
          reuseExistingServer: true,
          timeout: 180_000,
        },
        {
          command: "bun run dev -- --host 127.0.0.1 --port 5173",
          url: "http://127.0.0.1:5173",
          env: { VITE_PROXY_TARGET: backendUrl },
          reuseExistingServer: true,
          timeout: 120_000,
        },
      ],
})
