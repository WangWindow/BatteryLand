import { DownloadIcon, LinkExternalIcon } from "@primer/octicons-react"
import { Button } from "@primer/react"
import { useQueries, useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../api/client"
import type { Experiment, ExperimentSummary } from "../api/types"
import { Empty, ErrorNotice, Loading, PageHeader } from "../components/common"
import { ComparisonScatter } from "../features/multi-model/comparison-scatter"
import { ComparisonSoh } from "../features/multi-model/comparison-soh"
import {
  type CommonBattery,
  type ComparedRun,
  commonBatteries,
  comparisonCsv,
  comparisonSummaries,
  rowsFromResult,
  winnerCounts,
} from "../features/multi-model/data"
import { ErrorHeatmap } from "../features/multi-model/error-heatmap"
import "../features/multi-model/multi-model.css"

const colors = ["#0969da", "#f0883e", "#1a7f37", "#cf222e"]
type MetricKey = "mae" | "rmse" | "mape" | "accuracy15"

type Candidate = {
  summary: ExperimentSummary
  detail?: Experiment
  model: string
  dataset: string
  task: string
  compatibilityKey: string
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function nestedText(value: unknown, ...path: string[]): string | null {
  let current: unknown = value
  for (const key of path) current = record(current)?.[key]
  return typeof current === "string" && current.trim() ? current : null
}

function candidate(summary: ExperimentSummary, detail: Experiment | undefined): Candidate {
  const model = nestedText(detail?.config, "model", "type") ?? "未记录模型"
  const dataset = nestedText(detail?.config, "datafactory", "params", "dataset") ?? "未记录数据集"
  const task = nestedText(detail?.config, "task", "type") ?? "未记录任务"
  const split = detail?.split_sha256 || `${detail?.split_id ?? "unknown"}:v${detail?.split_version ?? "?"}`
  return { summary, detail, model, dataset, task, compatibilityKey: `${dataset}|${task}|${split}` }
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false })
}

function display(value: number | null, percent = false): string {
  if (value === null || !Number.isFinite(value)) return "—"
  return percent ? `${(value * 100).toFixed(2)}%` : value.toFixed(2)
}

function metricValue(item: ReturnType<typeof comparisonSummaries>[number], metric: MetricKey): number | null {
  return metric === "accuracy15" ? item.summary.accuracy15.value : item.summary[metric]
}

function metricLabel(metric: MetricKey): string {
  return { mae: "MAE", rmse: "RMSE", mape: "MAPE", accuracy15: "15%-ACC" }[metric]
}

function isPercent(metric: MetricKey): boolean {
  return metric === "mape" || metric === "accuracy15"
}

function saveComparison(runs: ComparedRun[], batteries: CommonBattery[]) {
  const blob = new Blob([comparisonCsv(runs, batteries)], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = "多模型共同测试集对比.csv"
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function MultiModelPage() {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [metric, setMetric] = useState<MetricKey>("mape")
  const autoSelected = useRef(false)
  const experiments = useQuery({
    queryKey: ["experiments", "multi-model", "succeeded"],
    queryFn: ({ signal }) => api.experiments({ state: "succeeded", page_size: 100 }, signal),
  })
  const summaries = experiments.data?.items ?? []
  const detailQueries = useQueries({
    queries: summaries.map((item) => ({
      queryKey: ["experiment", item.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.experiment(item.id, signal),
    })),
  })
  const candidates = useMemo(
    () => summaries.map((item, index) => candidate(item, detailQueries[index]?.data)),
    [detailQueries, summaries],
  )

  useEffect(() => {
    if (autoSelected.current || candidates.length < 2 || candidates.some((item) => !item.detail)) return
    autoSelected.current = true
    const groups = new Map<string, string[]>()
    for (const item of candidates) {
      const ids = groups.get(item.compatibilityKey) ?? []
      ids.push(item.summary.id)
      groups.set(item.compatibilityKey, ids)
    }
    const firstComparable = [...groups.values()].find((ids) => ids.length >= 2)
    if (firstComparable) setSelectedIds(firstComparable.slice(0, 2))
  }, [candidates])

  const selectedCandidates = selectedIds.flatMap((id) => {
    const item = candidates.find((candidateItem) => candidateItem.summary.id === id)
    return item ? [item] : []
  })
  const baseline = selectedCandidates[0]
  const resultQueries = useQueries({
    queries: selectedIds.map((id) => ({
      queryKey: ["result", id],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.results(id, signal),
    })),
  })
  const runs = useMemo<ComparedRun[]>(
    () =>
      selectedCandidates.flatMap((item, index) => {
        const result = resultQueries[index]?.data
        if (!result?.available) return []
        return [
          {
            id: item.summary.id,
            name: `${item.model} · ${item.summary.name}`,
            model: item.model,
            color: colors[index],
            rows: rowsFromResult(result),
          },
        ]
      }),
    [resultQueries, selectedCandidates],
  )
  const batteries = useMemo(() => commonBatteries(runs), [runs])
  const compared = useMemo(() => comparisonSummaries(runs, batteries), [runs, batteries])
  const wins = useMemo(() => winnerCounts(runs, batteries), [runs, batteries])
  const curveFiles = useMemo(() => batteries.map((battery) => battery.fileName).slice(0, 200), [batteries])
  const curves = useQuery({
    queryKey: ["multi-model-soh-curves", baseline?.dataset, curveFiles],
    queryFn: () =>
      api.sohCurves({ dataset_name: baseline?.dataset ?? "", file_names: curveFiles, max_points: 300 }),
    enabled: runs.length >= 2 && curveFiles.length > 0 && Boolean(baseline?.dataset),
  })

  const detailsPending = summaries.length > 0 && detailQueries.some((query) => query.isPending)
  const resultsPending = selectedIds.length >= 2 && resultQueries.some((query) => query.isPending)
  const requestError =
    experiments.error ??
    detailQueries.find((query) => query.error)?.error ??
    resultQueries.find((query) => query.error)?.error
  const selectedResultsReady = selectedIds.length >= 2 && resultQueries.every((query) => query.isSuccess)
  const missingResults = selectedResultsReady && runs.length !== selectedIds.length
  const totalComparableRows = runs.length ? Math.max(...runs.map((run) => run.rows.length)) : 0
  const omitted = Math.max(0, totalComparableRows - batteries.length)
  const bestByMetric = (key: MetricKey) => {
    const values = compared.flatMap((item) => {
      const value = metricValue(item, key)
      return value === null ? [] : [{ id: item.run.id, value }]
    })
    if (!values.length) return ""
    const best =
      key === "accuracy15"
        ? Math.max(...values.map((item) => item.value))
        : Math.min(...values.map((item) => item.value))
    return values.find((item) => Math.abs(item.value - best) <= 1e-12)?.id ?? ""
  }
  const chartMaximum = Math.max(1e-12, ...compared.map((item) => metricValue(item, metric) ?? 0))
  const bestMap = {
    mae: bestByMetric("mae"),
    rmse: bestByMetric("rmse"),
    mape: bestByMetric("mape"),
    accuracy15: bestByMetric("accuracy15"),
  }
  const bestMape = compared.find((item) => item.run.id === bestMap.mape)
  const baselineMape = compared[0]?.summary.mape
  const improvement =
    baselineMape !== null && baselineMape !== undefined && bestMape?.summary.mape !== null
      ? baselineMape - (bestMape?.summary.mape ?? baselineMape)
      : null

  function toggleExperiment(item: Candidate, checked: boolean) {
    setSelectedIds((current) => {
      if (!checked) return current.filter((id) => id !== item.summary.id)
      if (current.includes(item.summary.id) || current.length >= 4) return current
      return [...current, item.summary.id]
    })
  }

  return (
    <div className="mm-page">
      <PageHeader
        title="多模型结果对比"
        description="选择2～4个使用相同数据划分的已完成实验，在共同测试电池上公平比较寿命预测结果。"
      />
      <ErrorNotice error={requestError} />

      <section className="mm-panel" aria-labelledby="mm-select-title">
        <div className="mm-heading">
          <div>
            <h2 id="mm-select-title">选择可比实验</h2>
            <p>第一个实验作为基准；数据集、任务或数据划分不同的实验不能同时选择。</p>
          </div>
          <Button as={Link} to="/experiments" leadingVisual={LinkExternalIcon}>
            前往实验模块
          </Button>
        </div>
        {experiments.isPending || detailsPending ? (
          <Loading label="正在读取已完成实验配置" />
        ) : !candidates.length ? (
          <Empty title="暂无已完成实验">
            <p>请先在“实验”模块完成至少两个可比实验。</p>
          </Empty>
        ) : (
          <div className="mm-experiment-grid">
            {candidates.map((item) => {
              const selected = selectedIds.includes(item.summary.id)
              const incompatible = Boolean(baseline && item.compatibilityKey !== baseline.compatibilityKey)
              const disabled = !selected && (incompatible || selectedIds.length >= 4 || !item.detail)
              return (
                <label
                  className={`mm-experiment-choice${selected ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`}
                  key={item.summary.id}
                  title={incompatible ? "与基准实验的数据集、任务或数据划分不一致" : undefined}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={disabled}
                    onChange={(event) => toggleExperiment(item, event.target.checked)}
                  />
                  <span>
                    <strong>{item.summary.name}</strong>
                    <small>
                      {item.model} · {item.dataset}
                    </small>
                    <small>
                      {item.detail
                        ? `划分 v${item.detail.split_version ?? "—"} · ${formatTime(item.summary.created_at)}`
                        : "正在读取配置"}
                    </small>
                  </span>
                  {selectedIds[0] === item.summary.id && <b className="mm-baseline-tag">基准</b>}
                  {incompatible && <b className="mm-incompatible-tag">不可比</b>}
                </label>
              )
            })}
          </div>
        )}
        <p className="mm-selection-note">已选择 {selectedIds.length} / 4 个实验。</p>
      </section>

      {selectedIds.length < 2 ? (
        <section className="mm-panel">
          <Empty title="请选择至少两个可比实验">
            <p>系统默认尝试选择最近的一组可比实验，也可以手动调整。</p>
          </Empty>
        </section>
      ) : resultsPending ? (
        <Loading label="正在读取多个实验的预测结果" />
      ) : missingResults ? (
        <section className="mm-panel">
          <Empty title="部分实验没有可用预测结果">
            <p>请确认所选实验的 best_result.json 均包含测试集预测记录。</p>
          </Empty>
        </section>
      ) : !batteries.length ? (
        <section className="mm-panel">
          <Empty title="没有可用于公平比较的共同测试电池">
            <p>所选实验没有共同且真实标签一致的测试记录。</p>
          </Empty>
        </section>
      ) : (
        <>
          <section className="mm-panel" aria-labelledby="mm-info-title">
            <div className="mm-heading">
              <div>
                <h2 id="mm-info-title">实验与模型信息</h2>
                <p>本次比较统一使用 {batteries.length} 块共同测试电池。</p>
              </div>
              <Button leadingVisual={DownloadIcon} onClick={() => saveComparison(runs, batteries)}>
                下载对比CSV
              </Button>
            </div>
            {omitted > 0 && (
              <div className="mm-notice">
                为保证公平比较，已排除 {omitted} 条非共同、缺失预测或真实标签不一致的记录。
              </div>
            )}
            <div className="mm-table-scroll">
              <table className="mm-info-table">
                <thead>
                  <tr>
                    <th>项目</th>
                    {selectedCandidates.map((item, index) => (
                      <th key={item.summary.id}>
                        <i style={{ background: colors[index] }} />
                        {item.model}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th>实验</th>
                    {selectedCandidates.map((item) => (
                      <td key={item.summary.id}>
                        <Link to={`/experiments/${item.summary.id}`}>{item.summary.name}</Link>
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th>数据集</th>
                    {selectedCandidates.map((item) => (
                      <td key={item.summary.id}>{item.dataset}</td>
                    ))}
                  </tr>
                  <tr>
                    <th>训练/验证/测试</th>
                    {selectedCandidates.map((item) => (
                      <td key={item.summary.id}>
                        {item.detail?.split_counts.train ?? 0} / {item.detail?.split_counts.val ?? 0} /{" "}
                        {item.detail?.split_counts.test ?? 0}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th>数据划分</th>
                    {selectedCandidates.map((item) => (
                      <td key={item.summary.id}>v{item.detail?.split_version ?? "—"}</td>
                    ))}
                  </tr>
                  <tr>
                    <th>最佳轮次</th>
                    {resultQueries.map((query, index) => (
                      <td key={selectedIds[index]}>{query.data?.best_epoch ?? "—"}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="mm-panel" aria-labelledby="mm-metrics-title">
            <div className="mm-heading">
              <div>
                <h2 id="mm-metrics-title">核心指标对比</h2>
                <p>所有指标均由共同测试电池重新计算，绿色表示当前最优结果。</p>
              </div>
            </div>
            <div className="mm-table-scroll">
              <table className="mm-metric-table">
                <thead>
                  <tr>
                    <th>模型与实验</th>
                    <th>MAE ↓</th>
                    <th>RMSE ↓</th>
                    <th>MAPE ↓</th>
                    <th>15%-ACC ↑</th>
                    <th>单电池最优</th>
                  </tr>
                </thead>
                <tbody>
                  {compared.map((item) => (
                    <tr key={item.run.id}>
                      <th>
                        <i style={{ background: item.run.color }} />
                        {item.run.name}
                      </th>
                      <td className={bestMap.mae === item.run.id ? "is-best" : undefined}>
                        {display(item.summary.mae)}
                      </td>
                      <td className={bestMap.rmse === item.run.id ? "is-best" : undefined}>
                        {display(item.summary.rmse)}
                      </td>
                      <td className={bestMap.mape === item.run.id ? "is-best" : undefined}>
                        {display(item.summary.mape, true)}
                      </td>
                      <td className={bestMap.accuracy15 === item.run.id ? "is-best" : undefined}>
                        {display(item.summary.accuracy15.value, true)}
                      </td>
                      <td>{wins[item.run.id]} 块</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mm-metric-chart">
              <fieldset className="mm-metric-tabs" aria-label="选择柱状图指标">
                {(["mae", "rmse", "mape", "accuracy15"] as MetricKey[]).map((key) => (
                  <button
                    type="button"
                    key={key}
                    className={metric === key ? "is-active" : undefined}
                    onClick={() => setMetric(key)}
                  >
                    {metricLabel(key)}
                  </button>
                ))}
              </fieldset>
              <div className="mm-bars">
                {compared.map((item) => {
                  const value = metricValue(item, metric) ?? 0
                  return (
                    <div className="mm-bar-row" key={item.run.id}>
                      <span>{item.run.model}</span>
                      <div>
                        <i
                          style={{
                            width: `${Math.max(2, (value / chartMaximum) * 100)}%`,
                            background: item.run.color,
                          }}
                        />
                      </div>
                      <strong>{display(value, isPercent(metric))}</strong>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>

          {bestMape && (
            <section className="mm-conclusion" aria-label="自动比较结论">
              <strong>比较结论</strong>
              <p>
                {bestMape.run.name} 在共同测试集上的MAPE最低，为 {display(bestMape.summary.mape, true)}
                {improvement !== null && improvement > 1e-12
                  ? `，比基准实验降低 ${(improvement * 100).toFixed(2)} 个百分点`
                  : ""}
                ；其15%误差范围内电池为 {bestMape.summary.accuracy15.passed} /{" "}
                {bestMape.summary.accuracy15.total}。
              </p>
            </section>
          )}

          <section className="mm-panel" aria-labelledby="mm-scatter-title">
            <h2 id="mm-scatter-title">预测值与真实值</h2>
            <ComparisonScatter runs={runs} batteries={batteries} />
          </section>

          <section className="mm-panel" aria-labelledby="mm-error-title">
            <div className="mm-heading">
              <div>
                <h2 id="mm-error-title">逐电池预测误差详细数据</h2>
                <p>逐项比较每块共同测试电池的真实EOL、模型预测值和相对误差。</p>
              </div>
            </div>
            <ErrorHeatmap runs={runs} batteries={batteries} />
          </section>

          <section className="mm-panel" aria-labelledby="mm-soh-title">
            <div className="mm-heading">
              <div>
                <h2 id="mm-soh-title">真实SOH退化曲线与多模型EOL预测</h2>
                <p>真实曲线只绘制一次；颜色区分电池，形状区分模型预测，菱形表示真实EOL。</p>
              </div>
            </div>
            {curves.isPending ? (
              <Loading label="正在读取共同测试电池真实循环数据" />
            ) : curves.error ? (
              <ErrorNotice error={curves.error} />
            ) : curves.data?.items.length ? (
              <ComparisonSoh
                key={selectedIds.join("|")}
                curves={curves.data.items}
                batteries={batteries}
                runs={runs}
              />
            ) : (
              <Empty title="暂无可用的真实SOH曲线">
                <p>{curves.data?.warnings.join("；") ?? "没有匹配到共同测试集的原始电池文件。"}</p>
              </Empty>
            )}
          </section>
        </>
      )}
    </div>
  )
}
