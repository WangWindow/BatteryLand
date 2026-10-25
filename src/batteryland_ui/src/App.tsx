import { lazy, Suspense } from "react"
import { useTranslation } from "react-i18next"
import { Navigate, Route, Routes } from "react-router-dom"

import { AppShell } from "@/components/app-shell"
import { LoadingState } from "@/components/data-state"
import { LazyBoundary } from "@/components/lazy-boundary"

const ResourcesPage = lazy(() =>
  import("@/pages/resources-page").then((module) => ({ default: module.ResourcesPage })),
)
const SplitsPage = lazy(() =>
  import("@/pages/splits-page").then((module) => ({ default: module.SplitsPage })),
)
const ComponentsPage = lazy(() =>
  import("@/pages/components-page").then((module) => ({ default: module.ComponentsPage })),
)
const ExperimentsPage = lazy(() =>
  import("@/pages/experiments-page").then((module) => ({ default: module.ExperimentsPage })),
)
const ExperimentEditorPage = lazy(() =>
  import("@/pages/experiment-editor-page").then((module) => ({
    default: module.ExperimentEditorPage,
  })),
)
const ExperimentDetailPage = lazy(() =>
  import("@/pages/experiment-detail-page").then((module) => ({
    default: module.ExperimentDetailPage,
  })),
)
const QueuePage = lazy(() =>
  import("@/pages/queue-page").then((module) => ({ default: module.QueuePage })),
)
const ComparisonPage = lazy(() =>
  import("@/pages/comparison-page").then((module) => ({ default: module.ComparisonPage })),
)

function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">{t("common.notFound.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("common.notFound.description")}</p>
    </div>
  )
}

export function App() {
  return (
    <LazyBoundary>
      <Suspense fallback={<LoadingState rows={6} />}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/resources" replace />} />
            <Route path="/resources" element={<ResourcesPage />} />
            <Route path="/splits" element={<SplitsPage />} />
            <Route path="/components" element={<ComponentsPage />} />
            <Route path="/experiments" element={<ExperimentsPage />} />
            <Route path="/experiments/new" element={<ExperimentEditorPage />} />
            <Route path="/experiments/:experimentId/edit" element={<ExperimentEditorPage />} />
            <Route path="/experiments/:experimentId" element={<ExperimentDetailPage />} />
            <Route path="/queue" element={<QueuePage />} />
            <Route path="/compare" element={<ComparisonPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
    </LazyBoundary>
  )
}

export default App
