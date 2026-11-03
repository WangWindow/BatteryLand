import { useTheme } from "@primer/react/next"
import type { ECharts } from "echarts"
import { LineChart, ScatterChart } from "echarts/charts"
import { DataZoomComponent, GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components"
import { init, use } from "echarts/core"
import { CanvasRenderer } from "echarts/renderers"
import { useEffect, useMemo, useRef } from "react"
import type { BatteryAnalysis, CapacityCycle } from "../api/types"

use([
  LineChart,
  ScatterChart,
  DataZoomComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
  CanvasRenderer,
])

type Unit = "relative" | "ah"

export function BatteryCapacityChart({
  analysis,
  unit,
  selectedIndex,
  onSelect,
}: {
  analysis: BatteryAnalysis
  unit: Unit
  selectedIndex: number | null
  onSelect: (index: number) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const chart = useRef<ECharts | null>(null)
  const choose = useRef(onSelect)
  const rows = useRef<CapacityCycle[]>([])
  const { colorMode } = useTheme()
  const valid = useMemo(
    () =>
      analysis.cycles.filter(
        (row) =>
          row.number !== null &&
          (unit === "ah" ? row.discharge_capacity_ah !== null : row.relative_capacity_percent !== null),
      ),
    [analysis.cycles, unit],
  )
  choose.current = onSelect
  rows.current = valid

  useEffect(() => {
    if (!host.current) return
    const instance = init(host.current, undefined, { renderer: "canvas" })
    chart.current = instance
    const resize = () => instance.resize()
    const handleRelease = (event: { offsetX: number; offsetY: number }) => {
      const location = [event.offsetX, event.offsetY]
      if (!instance.containPixel({ gridIndex: 0 }, location) || !rows.current.length) return
      const converted = instance.convertFromPixel({ xAxisIndex: 0 }, event.offsetX)
      const cycle = Number(converted)
      if (!Number.isFinite(cycle)) return
      const nearest = rows.current.reduce((best, row) =>
        Math.abs((row.number ?? 0) - cycle) < Math.abs((best.number ?? 0) - cycle) ? row : best,
      )
      choose.current(nearest.index)
    }
    instance.getZr().on("mouseup", handleRelease)
    window.addEventListener("resize", resize)
    return () => {
      instance.getZr().off("mouseup", handleRelease)
      window.removeEventListener("resize", resize)
      instance.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    const instance = chart.current
    if (!instance) return
    const dark = colorMode === "night" || colorMode === "dark"
    const text = dark ? "#9198a1" : "#59636e"
    const border = dark ? "#3d444d" : "#d8dee4"
    const background = dark ? "#0d1117" : "#fff"
    const plotted = analysis.cycles.filter((row) => row.number !== null)
    const last = Math.max(0, ...plotted.map((row) => row.number ?? 0))
    const label = analysis.life_label
    const end = Math.max(last, label ?? 0, 1)
    const previousZoom = (
      instance.getOption() as { dataZoom?: { start?: number; end?: number }[] } | undefined
    )?.dataZoom?.[0]
    instance.setOption(
      {
        animation: false,
        textStyle: { color: text },
        tooltip: {
          trigger: "item",
          backgroundColor: background,
          borderColor: border,
          textStyle: { color: text },
        },
        grid: { left: 68, right: 28, top: 32, bottom: 76 },
        xAxis: {
          type: "value",
          name: "实际 Cycle 编号",
          nameLocation: "middle",
          nameGap: 32,
          min: 0,
          max: Math.ceil(end * 1.02),
          axisLabel: { color: text },
          axisLine: { lineStyle: { color: border } },
        },
        yAxis: {
          type: "value",
          scale: true,
          name: unit === "ah" ? "放电容量 (Ah)" : "相对首个有效放电容量 (%)",
          nameLocation: "middle",
          nameGap: 54,
          axisLabel: { color: text },
          splitLine: { lineStyle: { color: border } },
        },
        dataZoom: [
          {
            type: "inside",
            xAxisIndex: 0,
            zoomOnMouseWheel: true,
            moveOnMouseWheel: false,
            start: previousZoom?.start ?? 0,
            end: previousZoom?.end ?? 100,
          },
          {
            type: "slider",
            xAxisIndex: 0,
            bottom: 18,
            height: 24,
            start: previousZoom?.start ?? 0,
            end: previousZoom?.end ?? 100,
          },
        ],
        series: [
          {
            id: "capacity",
            type: "line",
            name: "当前电池",
            showSymbol: valid.length < 80,
            symbolSize: 5,
            connectNulls: false,
            lineStyle: { color: "#1a7f37", width: 2 },
            itemStyle: { color: "#1a7f37" },
            data: plotted.map((row) => [
              row.number,
              unit === "ah" ? row.discharge_capacity_ah : row.relative_capacity_percent,
            ]),
            markLine:
              label === null
                ? undefined
                : {
                    symbol: "none",
                    silent: true,
                    lineStyle: { color: "#1a7f37", type: "dashed", width: 1.5 },
                    label: { formatter: `原有 EOL 标签 ${label}`, position: "insideEndTop", color: text },
                    data: [{ xAxis: label }],
                  },
          },
          {
            id: "selection",
            type: "scatter",
            name: "已选 Cycle",
            symbolSize: 12,
            itemStyle: { color: "#cf222e" },
            data: [],
          },
        ],
      },
      { replaceMerge: ["series"] },
    )
  }, [analysis, unit, valid, colorMode])

  useEffect(() => {
    const selected = valid.find((row) => row.index === selectedIndex)
    chart.current?.setOption({
      series: [
        {
          id: "selection",
          data: selected
            ? [
                [
                  selected.number,
                  unit === "ah" ? selected.discharge_capacity_ah : selected.relative_capacity_percent,
                ],
              ]
            : [],
        },
      ],
    })
  }, [selectedIndex, unit, valid])

  function handleKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    if (!valid.length) return
    event.preventDefault()
    const position = valid.findIndex((row) => row.index === selectedIndex)
    const next =
      event.key === "ArrowRight"
        ? Math.min(valid.length - 1, position + 1)
        : Math.max(0, position < 0 ? 0 : position - 1)
    onSelect(valid[next].index)
  }

  return (
    <>
      {!valid.length && <p className="subtle">没有可绘制的放电容量记录；仍可在下方查看已有 Cycle 的采样。</p>}
      <div
        ref={host}
        className="battery-capacity-canvas"
        role="slider"
        tabIndex={0}
        aria-label="在当前电池容量轨迹上选择实际 Cycle"
        aria-valuemin={valid[0]?.number ?? 0}
        aria-valuemax={valid[valid.length - 1]?.number ?? 0}
        aria-valuenow={valid.find((row) => row.index === selectedIndex)?.number ?? undefined}
        aria-valuetext={
          selectedIndex === null
            ? "未选择 Cycle"
            : `Cycle ${analysis.cycles[selectedIndex]?.number ?? "编号未提供"}`
        }
        onKeyDown={handleKey}
      />
    </>
  )
}
