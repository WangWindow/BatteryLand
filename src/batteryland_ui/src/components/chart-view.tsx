import { useTheme } from "@primer/react/next"
import type { ECharts } from "echarts"
import { BarChart, BoxplotChart, LineChart, ScatterChart } from "echarts/charts"
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components"
import { init, use } from "echarts/core"
import { CanvasRenderer } from "echarts/renderers"
import { useEffect, useRef } from "react"
import type { Chart } from "../api/types"

use([
  BarChart,
  BoxplotChart,
  LineChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
])

export type ViewChart = Omit<Chart, "kind" | "series"> & {
  kind: Chart["kind"] | "boxplot"
  horizontal?: boolean
  legendRight?: boolean
  staticLegendTopRight?: boolean
  pointSize?: number
  categories?: string[]
  overlapBars?: boolean
  series: (Chart["series"][number] & {
    box?: [number, number, number, number, number]
    color?: string
  })[]
}

export function ChartView({ chart }: { chart: ViewChart }) {
  const host = useRef<HTMLDivElement>(null)
  const { colorMode } = useTheme()
  useEffect(() => {
    if (!host.current) return
    const isDark = colorMode === "night" || colorMode === "dark"
    const styles = getComputedStyle(host.current)
    const textColor = styles.getPropertyValue("--fgColor-muted").trim() || (isDark ? "#9198a1" : "#59636e")
    const borderColor =
      styles.getPropertyValue("--borderColor-default").trim() || (isDark ? "#3d444d" : "#d8dee4")
    const surfaceColor = styles.getPropertyValue("--bgColor-default").trim() || (isDark ? "#0d1117" : "#fff")
    const instance: ECharts | undefined = init(host.current, undefined, { renderer: "canvas" })
    const resize = () => instance?.resize()
    const isBoxplot = chart.kind === "boxplot"
    const category = chart.x_axis.value_type === "category"
    const categories =
      chart.categories ??
      (category
        ? [...new Set(chart.series.flatMap((entry) => entry.points.map((point) => String(point.x))))]
        : [])
    const boxCategories = isBoxplot ? chart.series.map((item) => item.label) : []
    const series = isBoxplot
      ? [
          {
            name: chart.title,
            type: "boxplot",
            data: chart.series.map((item) => item.box),
          },
        ]
      : chart.series.map((item) => ({
          name: item.label,
          type: chart.kind === "scatter" ? "scatter" : chart.kind,
          data:
            category && chart.horizontal
              ? categories.map((value) => item.points.find((point) => String(point.x) === value)?.y ?? null)
              : category
                ? categories.map((value) => item.points.find((point) => String(point.x) === value)?.y ?? null)
                : item.points.map((point) => [point.x, point.y]),
          showSymbol: chart.kind !== "line" || item.points.length < 100,
          symbolSize: chart.kind === "scatter" ? (chart.pointSize ?? 7) : 5,
          itemStyle: item.color ? { color: item.color } : undefined,
          barGap: chart.overlapBars ? "-100%" : undefined,
          connectNulls: false,
          emphasis: { focus: "series" },
        }))
    instance.setOption({
      animation: false,
      color: ["#0969da", "#1a7f37", "#8250df", "#bc4c00", "#bf3989", "#0a7f83"],
      textStyle: { color: textColor },
      tooltip: {
        trigger: chart.kind === "scatter" ? "item" : "axis",
        backgroundColor: surfaceColor,
        borderColor,
        textStyle: { color: textColor },
      },
      legend: chart.staticLegendTopRight
        ? { show: false }
        : chart.legendRight
          ? {
              type: "scroll",
              top: 34,
              right: 8,
              orient: "vertical",
              itemWidth: 8,
              itemHeight: 8,
              itemGap: 9,
              textStyle: { color: textColor, fontSize: 12 },
            }
          : { type: "scroll", bottom: 0, textStyle: { color: textColor } },
      grid: {
        left: chart.horizontal ? 8 : 58,
        right: chart.legendRight ? 150 : 24,
        top: 28,
        bottom: 66,
        containLabel: chart.horizontal,
      },
      xAxis: {
        type: isBoxplot ? "category" : chart.horizontal ? "value" : category ? "category" : "value",
        name: chart.horizontal ? chart.y_axis.label : chart.x_axis.label,
        nameLocation: "middle",
        nameGap: 38,
        data: isBoxplot ? boxCategories : category && !chart.horizontal ? categories : undefined,
        axisLabel: { color: textColor, hideOverlap: true },
        nameTextStyle: { color: textColor },
        axisLine: { lineStyle: { color: borderColor } },
        splitLine: { show: !category },
      },
      yAxis: {
        type: chart.horizontal ? "category" : "value",
        name: chart.horizontal
          ? chart.x_axis.label
          : chart.y_axis.unit
            ? `${chart.y_axis.label} (${chart.y_axis.unit})`
            : chart.y_axis.label,
        data: chart.horizontal ? categories : undefined,
        inverse: chart.horizontal,
        axisLabel: { color: textColor },
        nameTextStyle: { color: textColor },
        axisLine: { lineStyle: { color: borderColor } },
        splitLine: { lineStyle: { color: borderColor } },
      },
      series,
    })
    window.addEventListener("resize", resize)
    return () => {
      window.removeEventListener("resize", resize)
      instance?.dispose()
    }
  }, [chart, colorMode])
  return (
    <section className="chart-panel">
      <div className="chart-panel-header">
        <h3>{chart.title}</h3>
        {chart.staticLegendTopRight && (
          <span className="chart-static-legend" aria-hidden="true">
            <span className="chart-static-legend-swatch" />
            {chart.title}
          </span>
        )}
      </div>
      {chart.warnings.length > 0 && (
        <ul className="warning-list">
          {chart.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      <div
        ref={host}
        className="chart"
        style={
          chart.horizontal ? { height: Math.max(360, chart.series[0].points.length * 34 + 100) } : undefined
        }
        role="img"
        aria-label={chart.title}
      />
    </section>
  )
}
