import "@primer/primitives/dist/css/functional/themes/light.css"
import "@primer/primitives/dist/css/functional/themes/dark.css"
import { ThemeProvider } from "@primer/react/next"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom"
import { SelectionProvider } from "./app/context"
import { Shell } from "./app/shell"
import "./styles.css"

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
})
const router = createBrowserRouter([
  {
    Component: Shell,
    HydrateFallback: () => (
      <div className="loading" role="status">
        正在加载工作台
      </div>
    ),
    children: [
      { index: true, element: <Navigate to="/batteries" replace /> },
      { path: "batteries", lazy: async () => ({ Component: (await import("./pages/batteries")).default }) },
      { path: "splits", lazy: async () => ({ Component: (await import("./pages/splits")).default }) },
      { path: "components", lazy: async () => ({ Component: (await import("./pages/components")).default }) },
      {
        path: "experiments",
        lazy: async () => ({ Component: (await import("./pages/experiments")).default }),
      },
      {
        path: "experiments/new",
        lazy: async () => ({ Component: (await import("./pages/experiment-editor")).default }),
      },
      {
        path: "experiments/:id",
        lazy: async () => ({ Component: (await import("./pages/experiment-detail")).default }),
      },
      { path: "scheduler", lazy: async () => ({ Component: (await import("./pages/scheduler")).default }) },
      {
        path: "analysis/datasets",
        lazy: async () => ({ Component: (await import("./pages/dataset-analysis")).default }),
      },
      {
        path: "analysis/experiments",
        lazy: async () => ({ Component: (await import("./pages/result-analysis")).default }),
      },
    ],
  },
])

const root = document.getElementById("root")
if (!root) throw new Error("Application root is missing")
const initialColorMode = (() => {
  try {
    return window.localStorage.getItem("batteryland.color-mode") === "night" ? "night" : "day"
  } catch {
    return "day"
  }
})()

createRoot(root).render(
  <StrictMode>
    <ThemeProvider colorMode={initialColorMode} dayScheme="light" nightScheme="dark">
      <QueryClientProvider client={queryClient}>
        <SelectionProvider>
          <RouterProvider router={router} />
        </SelectionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
