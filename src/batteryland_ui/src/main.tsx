import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"

import "@/i18n"
import "./index.css"
import App from "@/App"
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
      <App />
      <Toaster position="top-right" />
    </BrowserRouter>
  </StrictMode>,
)
