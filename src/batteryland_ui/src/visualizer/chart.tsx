import { useTranslation } from "react-i18next"

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from "recharts"

import type { ChartSpec } from "@/api/models"
import { EmptyState } from "@/components/data-state"
import { Badge } from "@/components/ui/badge"
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { chartSampleInfo, mergeRows, seriesColor } from "@/visualizer/transform"

function chartConfig(chart: ChartSpec): ChartConfig {
  return Object.fromEntries(
    chart.series.map((series, index) => [
      `series-${index}`,
      { label: series.label, color: seriesColor(series.id) },
    ]),
  )
}

function unitOf(chart: ChartSpec): string | undefined {
  const unit = chart.y_axis.unit
  return unit && unit !== "unknown" ? unit : undefined
}

export function ChartRenderer({ chart }: { chart: ChartSpec }) {
  const { t } = useTranslation()
  const sampled = chartSampleInfo(chart)
  if (sampled.series.every((series) => series.points.length === 0)) {
    return (
      <EmptyState
        title={t("visualizer.noDataTitle")}
        description={chart.warnings.join("; ") || t("visualizer.noDataDescription")}
      />
    )
  }
  const config = chartConfig(chart)
  const numericX = chart.x_axis.value_type === "number" && chart.kind !== "bar"
  const unit = unitOf(chart)
  const rows = mergeRows(sampled.series).map((row) => {
    const complete = { ...row }
    for (let index = 0; index < sampled.series.length; index += 1) {
      const key = `series-${index}`
      if (!(key in complete)) {
        complete[key] = null
      }
    }
    return complete
  })

  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-card p-4" aria-label={chart.title}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold">{chart.title}</h3>
          <p className="text-xs text-muted-foreground">
            {chart.x_axis.label}
            {chart.y_axis.label ? ` · ${chart.y_axis.label}` : ""}
            {unit
              ? t("visualizer.unitSuffix", { unit })
              : chart.y_axis.unit === "unknown"
                ? t("visualizer.unknownUnit")
                : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {sampled.sampled ? (
            <Badge variant="outline">
              {t("visualizer.sampled", { count: sampled.originalCount })}
            </Badge>
          ) : null}
          {chart.warnings.map((warning) => (
            <Badge key={warning} variant="outline" className="border-warning/30 text-warning">
              {warning}
            </Badge>
          ))}
        </div>
      </header>

      {chart.kind === "scatter" ? (
        <ChartContainer config={config} className="aspect-auto h-80 w-full">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 20, left: 8 }}>
            <CartesianGrid />
            <XAxis
              type="number"
              dataKey="x"
              name={chart.x_axis.label}
              unit={
                chart.x_axis.unit && chart.x_axis.unit !== "unknown" ? chart.x_axis.unit : undefined
              }
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="number"
              dataKey="y"
              name={chart.y_axis.label}
              unit={unit}
              tickLine={false}
              axisLine={false}
              width={64}
            />
            <ChartTooltip content={<ChartTooltipContent />} cursor={{ strokeDasharray: "3 3" }} />
            <ChartLegend content={<ChartLegendContent />} />
            {sampled.series.map((series, index) => (
              <Scatter
                key={series.id}
                name={`series-${index}`}
                data={series.points.map((point) => ({
                  x: typeof point.x === "number" ? point.x : Number(point.x),
                  y: point.y,
                }))}
                fill={seriesColor(series.id)}
              />
            ))}
          </ScatterChart>
        </ChartContainer>
      ) : chart.kind === "bar" ? (
        <ChartContainer config={config} className="aspect-auto h-80 w-full">
          <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 20, left: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="x" tickLine={false} axisLine={false} />
            <YAxis unit={unit} tickLine={false} axisLine={false} width={64} allowDecimals={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            {sampled.series.map((series, index) => (
              <Bar
                key={series.id}
                dataKey={`series-${index}`}
                name={`series-${index}`}
                fill={seriesColor(series.id)}
                radius={[3, 3, 0, 0]}
              />
            ))}
          </BarChart>
        </ChartContainer>
      ) : (
        <ChartContainer config={config} className="aspect-auto h-80 w-full">
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 20, left: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="x"
              type={numericX ? "number" : "category"}
              tickLine={false}
              axisLine={false}
              allowDuplicatedCategory={false}
              domain={numericX ? ["auto", "auto"] : undefined}
            />
            <YAxis unit={unit} tickLine={false} axisLine={false} width={64} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            {sampled.series.map((series, index) => (
              <Line
                key={series.id}
                dataKey={`series-${index}`}
                name={`series-${index}`}
                stroke={seriesColor(series.id)}
                strokeWidth={2}
                dot={sampled.series.length === 1 && series.points.length <= 30}
                activeDot={{ r: 4 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      )}
    </section>
  )
}

export default ChartRenderer
