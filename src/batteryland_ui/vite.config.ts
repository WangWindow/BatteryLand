import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

const proxy = {
  "/api": {
    target: process.env.VITE_PROXY_TARGET ?? "http://127.0.0.1:8000",
    changeOrigin: false,
  },
  "/__test__": {
    target: process.env.VITE_PROXY_TARGET ?? "http://127.0.0.1:8000",
    changeOrigin: false,
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  server: { host: "0.0.0.0", proxy },
  preview: { proxy },
  build: {
    outDir: "dist",
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    clearMocks: true,
  },
})
