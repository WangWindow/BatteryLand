import { useTranslation } from "react-i18next"

import type { ChartBundle } from "@/api/models"
import { EmptyState } from "@/components/data-state"
import { ChartRenderer } from "@/visualizer/chart"

export function Visualizer({ bundle }: { bundle: ChartBundle }) {
  const { t } = useTranslation()
  if (bundle.charts.length === 0) {
    return (
      <EmptyState
        title={t("visualizer.noChartsTitle")}
        description={bundle.warnings.join("; ") || t("visualizer.noChartsDescription")}
      />
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {bundle.charts.map((chart) => (
        <ChartRenderer key={chart.id} chart={chart} />
      ))}
    </div>
  )
}

export default Visualizer
