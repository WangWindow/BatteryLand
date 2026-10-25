import { QueryClientProvider } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"

import "@/i18n"
import "./index.css"
import App from "@/App"
import { queryClient } from "@/api/query-client"
import { applyAppearancePreference, readAppearancePreference } from "@/components/appearance"
import { Toaster } from "@/components/ui/sonner"

applyAppearancePreference(readAppearancePreference())

const root = document.getElementById("root")
if (!root) {
  throw new Error("Application root element is missing")
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster position="top-right" />
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
)
