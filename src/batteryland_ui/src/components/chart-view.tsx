import { useTheme } from "@primer/react/next"
import type { ECharts } from "echarts"
import { BarChart, LineChart, ScatterChart } from "echarts/charts"
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components"
import { init, use } from "echarts/core"
import { CanvasRenderer } from "echarts/renderers"
import { useEffect, useRef } from "react"
import type { Chart } from "../api/types"

use([BarChart, LineChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

export function ChartView({ chart }: { chart: Chart }) {
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
    const category = chart.x_axis.value_type === "category"
    const categories = category
      ? [...new Set(chart.series.flatMap((entry) => entry.points.map((point) => String(point.x))))]
      : []
    const series = chart.series.map((item) => ({
      name: item.label,
      type: chart.kind === "scatter" ? "scatter" : chart.kind,
      data: category
        ? categories.map((value) => item.points.find((point) => String(point.x) === value)?.y ?? null)
        : item.points.map((point) => [point.x, point.y]),
      showSymbol: chart.kind !== "line" || item.points.length < 100,
      symbolSize: chart.kind === "scatter" ? 7 : 5,
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
      legend: { type: "scroll", bottom: 0, textStyle: { color: textColor } },
      grid: { left: 58, right: 24, top: 28, bottom: 66, containLabel: false },
      xAxis: {
        type: category ? "category" : "value",
        name: chart.x_axis.label,
        nameLocation: "middle",
        nameGap: 38,
        data: category ? categories : undefined,
        axisLabel: { color: textColor },
        nameTextStyle: { color: textColor },
        axisLine: { lineStyle: { color: borderColor } },
        splitLine: { show: !category },
      },
      yAxis: {
        type: "value",
        name: chart.y_axis.unit ? `${chart.y_axis.label} (${chart.y_axis.unit})` : chart.y_axis.label,
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
      <h3>{chart.title}</h3>
      {chart.warnings.length > 0 && (
        <ul className="warning-list">
          {chart.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      <div ref={host} className="chart" role="img" aria-label={chart.title} />
    </section>
  )
}
