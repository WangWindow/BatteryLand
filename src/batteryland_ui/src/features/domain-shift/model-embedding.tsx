import { Button } from "@primer/react"
import { useTheme } from "@primer/react/next"
import type { ECharts, EChartsOption } from "echarts"
import { ScatterChart } from "echarts/charts"
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  ToolboxComponent,
  TooltipComponent,
} from "echarts/components"
import { init, use } from "echarts/core"
import { CanvasRenderer } from "echarts/renderers"
import { useEffect, useMemo, useRef, useState } from "react"
import type { DomainShiftAnalysis, DomainShiftModelAnalysis } from "../../api/types"
import "./model-embedding.css"

use([
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  DataZoomComponent,
  ToolboxComponent,
  CanvasRenderer,
])

const palette = [
  "#0072b2",
  "#d55e00",
  "#cc79a7",
  "#332288",
  "#e69f00",
  "#009e73",
  "#56b4e9",
  "#b59b00",
  "#d62728",
  "#9467bd",
]
const targetColors: Record<string, string> = {
  CALCE: "#0072b2",
  HNEI: "#d55e00",
  MATR: "#cc79a7",
  SNL: "#332288",
  MICH_EXP: "#e69f00",
  MICH: "#009e73",
  RWTH: "#56b4e9",
  HUST: "#b59b00",
  Tongji: "#333333",
  XJTU: "#d62728",
  SDU: "#9467bd",
}
const cross = "path://M-6,-1 L-1,-1 L-1,-6 L1,-6 L1,-1 L6,-1 L6,1 L1,1 L1,6 L-1,6 L-1,1 L-6,1 Z"
const display = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? "—" : value.toFixed(4)
const percent = (value: number | null) =>
  value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(1)}%`

export function embeddingChartOptions(analysis: DomainShiftModelAnalysis, dark: boolean): EChartsOption {
  const source = analysis.points.filter((point) => point.domain === "源域")
  const targets = new Map<string, typeof analysis.points>()
  for (const point of analysis.points.filter((point) => point.domain !== "源域")) {
    const group = targets.get(point.dataset) ?? []
    group.push(point)
    targets.set(point.dataset, group)
  }
  const text = dark ? "#c9d1d9" : "#59636e"
  const border = dark ? "#3d444d" : "#d8dee4"
  const method = analysis.method === "tsne" ? "t-SNE" : "PCA"
  const data = (points: typeof analysis.points) =>
    points.map((point) => ({ ...point, value: [point.x, point.y] }))
  return {
    animation: false,
    backgroundColor: dark ? "#0d1117" : "#ffffff",
    textStyle: { color: text },
    aria: { enabled: true, description: "源域灰色十字、目标域彩色圆点，全部数据联合降维。" },
    tooltip: {
      trigger: "item",
      renderMode: "richText",
      formatter: (raw) => {
        const item = Array.isArray(raw) ? raw[0] : raw
        const point = item.data as DomainShiftModelAnalysis["points"][number]
        return `${point.dataset_name} · ${point.domain}\n电池：${point.cell_uid}${point.cycle_number == null ? "" : `\n窗口结束循环：${point.cycle_number}`}\n${method} 1：${display(point.x)}\n${method} 2：${display(point.y)}`
      },
    },
    legend: { type: "scroll", top: 8, textStyle: { color: text } },
    toolbox: {
      top: 38,
      right: 8,
      feature: {
        restore: { title: "重置视图" },
        saveAsImage: { title: "下载 PNG", name: `battery-domain-${analysis.method}`, pixelRatio: 3 },
      },
    },
    grid: { left: 64, right: 30, top: 80, bottom: 80 },
    xAxis: {
      type: "value",
      name: `${method} dimension 1`,
      nameLocation: "middle",
      nameGap: 38,
      axisLine: { lineStyle: { color: border } },
      splitLine: { lineStyle: { color: border, opacity: 0.4 } },
    },
    yAxis: {
      type: "value",
      name: `${method} dimension 2`,
      nameLocation: "middle",
      nameGap: 48,
      axisLine: { lineStyle: { color: border } },
      splitLine: { lineStyle: { color: border, opacity: 0.4 } },
    },
    dataZoom: [
      { type: "inside", xAxisIndex: 0 },
      { type: "inside", yAxisIndex: 0 },
      { type: "slider", xAxisIndex: 0, bottom: 8, height: 18 },
    ],
    series: [
      {
        id: "source",
        name: `源域（${source.length}）`,
        type: "scatter",
        symbol: cross,
        symbolSize: 12,
        itemStyle: { color: "#999999", opacity: 0.55 },
        data: data(source),
        z: 2,
      },
      ...[...targets].map(([id, points], index) => ({
        id,
        name: `${points[0].dataset_name}（${points.length}）`,
        type: "scatter" as const,
        symbol: "circle",
        symbolSize: 10,
        itemStyle: {
          color: targetColors[points[0].dataset_name] ?? palette[index % palette.length],
          opacity: 0.7,
          borderColor: dark ? "#0d1117" : "#ffffff",
          borderWidth: 0.7,
        },
        data: data(points),
        z: 3,
      })),
    ],
  }
}

export function ModelEmbeddingChart({ analysis }: { analysis: DomainShiftModelAnalysis }) {
  const host = useRef<HTMLDivElement>(null)
  const instance = useRef<ECharts | null>(null)
  const { colorMode } = useTheme()
  useEffect(() => {
    if (!host.current) return
    const chart = init(host.current, undefined, { renderer: "canvas" })
    instance.current = chart
    chart.setOption(embeddingChartOptions(analysis, colorMode === "dark" || colorMode === "night"))
    const resize = () => chart.resize()
    window.addEventListener("resize", resize)
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize)
    observer?.observe(host.current)
    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", resize)
      chart.dispose()
      instance.current = null
    }
  }, [analysis, colorMode])
  return (
    <div
      ref={host}
      className="embedding-chart"
      role="img"
      aria-label="源域与目标域模型 embedding 联合降维图"
    />
  )
}

export function ModelEmbeddingResults({ result }: { result: DomainShiftAnalysis }) {
  const analysis = result.model_analysis
  const [target, setTarget] = useState("")
  const [search, setSearch] = useState("")
  const matches = useMemo(
    () =>
      analysis?.matches.filter(
        (row) =>
          (!target || row.target_id === target) &&
          (!search || row.cell_uid.toLowerCase().includes(search.toLowerCase())),
      ) ?? [],
    [analysis, target, search],
  )
  if (!analysis) return <p className="subtle">模型特征分析结果尚不可用，请重新开始分析。</p>
  const method = analysis.method === "tsne" ? "t-SNE" : "PCA"
  const representation = result.representation
  return (
    <div className="embedding-results">
      <section className="embedding-intro">
        <span className="embedding-eyebrow">模型表示分析</span>
        <h2>源域与目标域的特征空间</h2>
        <p>
          {representation?.model_type} ·{" "}
          {representation?.weight_source === "random"
            ? `随机初始化（种子 ${representation.initialization_seed}）`
            : representation?.checkpoint_name}{" "}
          · embedding
        </p>
        <div className="domain-metrics">
          <section className="domain-metric">
            <span>输入 / 池化维度</span>
            <strong>
              {analysis.input_dimensions} / {analysis.pooled_dimensions}
            </strong>
          </section>
          <section className="domain-metric">
            <span>分析样本（{result.summary.sample_unit}）</span>
            <strong>{result.summary.sample_count.toLocaleString()}</strong>
          </section>
          <section className="domain-metric">
            <span>源域 / 目标域数据集</span>
            <strong>
              {result.summary.source_count} / {result.summary.target_count}
            </strong>
          </section>
        </div>
      </section>
      <section className="embedding-plot-panel">
        <div className="embedding-panel-heading">
          <h3>{method} 联合降维图</h3>
          <span>{analysis.points.length.toLocaleString()} 个点</span>
        </div>
        <p className="subtle">
          源域为灰色十字，目标域按数据集着色。悬停查看电池，点击图例筛选，滚轮缩放，可下载 PNG。
        </p>
        <ModelEmbeddingChart analysis={analysis} />
        <p className="embedding-caption">
          {result.summary.sample_unit === "电池"
            ? "每个点代表一块电池的窗口 embedding 均值。"
            : "每个点代表一个早期循环窗口。"}
          全部源域和目标域联合拟合；二维图用于观察局部分布，相近程度结合下方原始表示的距离判断。
        </p>
        <p className="subtle">
          {analysis.method === "tsne"
            ? `PCA 预降维：${analysis.pca_dimensions} 维 · 实际 perplexity：${display(analysis.perplexity)}`
            : `PC1 / PC2 解释方差：${((analysis.explained_variance[0] ?? 0) * 100).toFixed(1)}% / ${((analysis.explained_variance[1] ?? 0) * 100).toFixed(1)}%`}
        </p>
      </section>
      {analysis.warnings.length > 0 && (
        <ul className="warning-list">
          {analysis.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      <section className="embedding-distance-panel">
        <h3>目标域与源域的接近程度</h3>
        <p className="subtle">
          距离使用池化 embedding 的余弦距离，越小表示方向越接近。参考范围取源域电池最近邻距离的 95% 分位：
          {display(analysis.reference_threshold)}
          。超出比例表示相对源域内部差异较大，不对应固定的迁移性能结论。
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>目标域</th>
                <th>电池数</th>
                <th>中心余弦距离</th>
                <th>最近源域电池平均距离</th>
                <th>超出源域参考范围</th>
              </tr>
            </thead>
            <tbody>
              {analysis.similarities.map((row) => (
                <tr key={row.target_id}>
                  <td>{row.target_name}</td>
                  <td>{row.samples}</td>
                  <td>{display(row.centroid_cosine_distance)}</td>
                  <td>{display(row.mean_nearest_source_distance)}</td>
                  <td>{percent(row.outside_source_fraction)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="embedding-distance-panel">
        <h3>目标电池的源域最近邻</h3>
        <div className="embedding-match-controls">
          <label>
            目标域
            <select
              aria-label="匹配表目标域"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value="">全部目标域</option>
              {analysis.similarities.map((row) => (
                <option key={row.target_id} value={row.target_id}>
                  {row.target_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            查找电池
            <input
              aria-label="查找目标电池"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="电池编号或文件名"
            />
          </label>
          <Button
            onClick={() => {
              setTarget("")
              setSearch("")
            }}
          >
            清空筛选
          </Button>
        </div>
        <div className="table-wrap embedding-match-table">
          <table>
            <thead>
              <tr>
                <th>目标域</th>
                <th>目标电池</th>
                <th>最近源域</th>
                <th>源域电池</th>
                <th>余弦距离</th>
                <th>源域参考范围</th>
              </tr>
            </thead>
            <tbody>
              {matches.slice(0, 2000).map((row) => (
                <tr key={`${row.target_id}:${row.cell_uid}`}>
                  <td>{row.target_name}</td>
                  <td>{row.cell_uid}</td>
                  <td>{row.nearest_source_name || "—"}</td>
                  <td>{row.nearest_source_cell_uid || "—"}</td>
                  <td>{display(row.cosine_distance)}</td>
                  <td>
                    {row.outside_source == null
                      ? "无法判断"
                      : row.outside_source
                        ? "超出参考范围"
                        : "参考范围内"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {matches.length === 0 && <p className="subtle">没有符合筛选条件的目标电池。</p>}
        {matches.length > 2000 && (
          <p className="subtle">
            当前匹配 {matches.length} 块电池，显示前 2000 条；可按目标域或电池编号筛选。
          </p>
        )}
      </section>
      <details className="domain-details">
        <summary>模型分析数据概览</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>数据集</th>
                <th>域</th>
                <th>电池数</th>
                <th>提取窗口</th>
                <th>分析样本</th>
              </tr>
            </thead>
            <tbody>
              {result.datasets.map((row) => (
                <tr key={row.source_id}>
                  <td>{row.name}</td>
                  <td>{row.domain}</td>
                  <td>{row.cells}</td>
                  <td>{row.extracted_cycles}</td>
                  <td>{row.samples}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
