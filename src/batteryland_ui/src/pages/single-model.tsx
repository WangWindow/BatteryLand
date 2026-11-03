import { DownloadIcon, LinkExternalIcon } from "@primer/octicons-react"
import { Button, FormControl, Select } from "@primer/react"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../api/client"
import type { Result } from "../api/types"
import { Empty, ErrorNotice, Loading, PageHeader, StateTag } from "../components/common"
import {
  absoluteError,
  type Prediction,
  predictionCsv,
  relativeError,
  summarize,
} from "../features/single-model/data"
import { PredictionScatter } from "../features/single-model/prediction-scatter"
import { SohCurveGrid } from "../features/single-model/soh-curve-grid"
import "../features/single-model/single-model.css"

type RowFilter = "all" | "failed" | "missing"

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

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function rowsFromResult(result: Result | undefined): Prediction[] {
  return (result?.predictions ?? []).map((item) => ({
    id: item.battery_id.startsWith("unresolved:") ? item.file_name : item.battery_id,
    fileName: item.file_name,
    prediction: finite(item.prediction),
    target: finite(item.target),
    lower: null,
    upper: null,
    granularity: item.granularity,
  }))
}

function display(value: number | null, percent = false): string {
  if (value === null || !Number.isFinite(value)) return "—"
  return percent ? `${(value * 100).toFixed(2)}%` : value.toFixed(2)
}

function targetName(task: string | null): string {
  if (!task) return "未记录"
  return task.toLowerCase().includes("batterylife") ? "电池寿命（EOL）" : task
}

function formatTime(value: string | undefined): string {
  if (!value) return "未记录"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false })
}

function saveText(name: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

function downloadCsv(name: string, rows: Prediction[]) {
  const safeName = name.replaceAll(/[\\/:*?"<>|]/g, "_") || "单模型预测"
  saveText(`${safeName}-预测结果.csv`, predictionCsv(rows), "text/csv;charset=utf-8")
}

export default function SingleModelPage() {
  const [experimentId, setExperimentId] = useState("")
  const [query, setQuery] = useState("")
  const [rowFilter, setRowFilter] = useState<RowFilter>("all")

  const experiments = useQuery({
    queryKey: ["experiments", "single-model", "succeeded"],
    queryFn: ({ signal }) => api.experiments({ state: "succeeded", page_size: 100 }, signal),
  })

  useEffect(() => {
    if (!experimentId && experiments.data?.items.length) {
      setExperimentId(experiments.data.items[0].id)
    }
  }, [experimentId, experiments.data])

  const experiment = useQuery({
    queryKey: ["experiment", experimentId],
    queryFn: ({ signal }) => api.experiment(experimentId, signal),
    enabled: Boolean(experimentId),
  })
  const result = useQuery({
    queryKey: ["result", experimentId],
    queryFn: ({ signal }) => api.results(experimentId, signal),
    enabled: Boolean(experimentId),
  })

  const rows = useMemo(() => rowsFromResult(result.data), [result.data])
  const hasData = rows.length > 0
  const summary = useMemo(() => summarize(rows), [rows])
  const selected = experiments.data?.items.find((item) => item.id === experimentId)
  const model = nestedText(experiment.data?.config, "model", "type") ?? "未记录"
  const dataset = nestedText(experiment.data?.config, "datafactory", "params", "dataset") ?? "未记录"
  const predictionTarget = targetName(nestedText(experiment.data?.config, "task", "type"))
  const curveFiles = useMemo(
    () => Array.from(new Set(rows.map((row) => row.fileName).filter(Boolean))).slice(0, 200),
    [rows],
  )
  const sohCurves = useQuery({
    queryKey: ["single-model-soh-curves", experimentId, dataset, curveFiles],
    queryFn: () => api.sohCurves({ dataset_name: dataset, file_names: curveFiles, max_points: 300 }),
    enabled: hasData && curveFiles.length > 0 && dataset !== "未记录",
  })

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (normalized && !`${row.id} ${row.fileName}`.toLowerCase().includes(normalized)) return false
      if (rowFilter === "failed") return (relativeError(row) ?? 0) > 0.15 + 1e-12
      if (rowFilter === "missing") return row.prediction === null || row.target === null
      return true
    })
  }, [query, rowFilter, rows])

  const loading =
    experiments.isPending || (Boolean(experimentId) && (experiment.isPending || result.isPending))
  const requestError = experiments.error ?? experiment.error ?? result.error

  function resetRows() {
    setQuery("")
    setRowFilter("all")
  }

  return (
    <div className="sp-page">
      <PageHeader
        title="单模型预测"
        description="选择一个已完成实验，分析该模型在测试集上的寿命预测、误差指标和真实 SOH 退化曲线。"
      />
      <ErrorNotice error={requestError} />

      <section className="sp-panel sp-experiment-panel" aria-labelledby="sp-experiment-title">
        <div className="sp-heading">
          <div>
            <h2 id="sp-experiment-title">选择已完成实验</h2>
          </div>
          <Button as={Link} to="/experiments" leadingVisual={LinkExternalIcon}>
            前往实验模块
          </Button>
        </div>
        <div className="sp-filters sp-experiment-controls">
          <FormControl className="sp-experiment-select">
            <FormControl.Label>已完成实验</FormControl.Label>
            <Select
              aria-label="已完成实验"
              value={experimentId}
              disabled={experiments.isPending || !experiments.data?.items.length}
              onChange={(event) => {
                setExperimentId(event.target.value)
                resetRows()
              }}
            >
              {!experiments.data?.items.length && <Select.Option value="">暂无可用实验</Select.Option>}
              {experiments.data?.items.map((item) => (
                <Select.Option key={item.id} value={item.id}>
                  {item.name} · {formatTime(item.created_at)}
                </Select.Option>
              ))}
            </Select>
          </FormControl>
          {selected && <StateTag state={selected.state} />}
          {experimentId && (
            <Button as={Link} to={`/experiments/${experimentId}`} leadingVisual={LinkExternalIcon}>
              查看实验详情
            </Button>
          )}
        </div>
      </section>

      {loading ? (
        <Loading label="正在加载实验预测结果" />
      ) : !experiments.data?.items.length ? (
        <section className="sp-panel">
          <Empty title="暂无已完成实验">
            <p>请先到“实验”模块新建实验、校验并提交训练；训练完成后会自动出现在这里。</p>
            <Button as={Link} to="/experiments/new">
              新建实验
            </Button>
          </Empty>
        </section>
      ) : !result.data?.available ? (
        <section className="sp-panel">
          <Empty title="该实验没有可用结果">
            <p>{result.data?.reason ?? "实验已完成，但尚未收集到 best_result.json。"}</p>
          </Empty>
        </section>
      ) : !hasData ? (
        <section className="sp-panel">
          <Empty title="该实验没有测试集预测记录">
            <p>实验结果中已有指标，但 best_result.json 没有提供 test_predictions 数据。</p>
          </Empty>
        </section>
      ) : (
        <>
          <section className="sp-panel" aria-labelledby="sp-model-title">
            <div className="sp-heading">
              <h2 id="sp-model-title">实验与模型信息</h2>
              <span className="sp-real">真实实验结果</span>
            </div>
            <dl className="sp-meta-grid">
              <div>
                <dt>实验</dt>
                <dd>{selected?.name ?? "未记录"}</dd>
              </div>
              <div>
                <dt>模型</dt>
                <dd>{model}</dd>
              </div>
              <div>
                <dt>数据集</dt>
                <dd>{dataset}</dd>
              </div>
              <div>
                <dt>预测目标</dt>
                <dd>{predictionTarget}</dd>
              </div>
              <div>
                <dt>训练/验证/测试</dt>
                <dd>
                  {experiment.data?.split_counts.train ?? 0} / {experiment.data?.split_counts.val ?? 0} /{" "}
                  {experiment.data?.split_counts.test ?? 0}
                </dd>
              </div>
              <div>
                <dt>最佳轮次</dt>
                <dd>{result.data?.best_epoch ?? "未记录"}</dd>
              </div>
              <div>
                <dt>配置版本</dt>
                <dd>v{experiment.data?.version ?? "—"}</dd>
              </div>
              <div>
                <dt>创建时间</dt>
                <dd>{formatTime(selected?.created_at)}</dd>
              </div>
            </dl>
          </section>

          <section className="sp-stat-grid" aria-label="预测指标">
            <div>
              <span>预测记录</span>
              <strong>{summary.predicted.toLocaleString()}</strong>
            </div>
            <div>
              <span>有效标签</span>
              <strong>{summary.labelled.toLocaleString()}</strong>
            </div>
            <div>
              <span>MAE</span>
              <strong>{display(summary.mae)}</strong>
            </div>
            <div>
              <span>RMSE</span>
              <strong>{display(summary.rmse)}</strong>
            </div>
            <div>
              <span>MAPE</span>
              <strong>{display(summary.mape, true)}</strong>
            </div>
            <div>
              <span>15%-ACC</span>
              <strong>{display(summary.accuracy15.value, true)}</strong>
            </div>
            <div>
              <span>MSE</span>
              <strong>{display(summary.mse)}</strong>
            </div>
          </section>

          <section className="sp-panel" aria-labelledby="sp-scatter-title">
            <h2 id="sp-scatter-title">预测值与真实值</h2>
            <PredictionScatter rows={rows} />
          </section>

          <section className="sp-panel" aria-labelledby="sp-soh-title">
            <h2 id="sp-soh-title">测试电池真实 SOH 退化曲线与 EOL 预测</h2>
            <p className="sp-note">
              曲线来自该实验测试集电池的真实循环容量；SOH = 当前循环最大放电容量 ÷
              标称容量（缺失时使用首循环容量）。圆点表示模型预测的 SOH=0.80 寿命位置，菱形表示真实 EOL。
            </p>
            {sohCurves.isPending ? (
              <Loading label="正在读取测试电池真实循环数据" />
            ) : sohCurves.error ? (
              <ErrorNotice error={sohCurves.error} />
            ) : sohCurves.data?.items.length ? (
              <SohCurveGrid key={experimentId} curves={sohCurves.data.items} rows={rows} />
            ) : (
              <Empty title="暂无可用的真实 SOH 曲线">
                <p>{sohCurves.data?.warnings.join("；") ?? "没有匹配到该实验测试集的原始电池文件。"}</p>
              </Empty>
            )}
            {sohCurves.data?.warnings.length ? (
              <details className="sp-soh-warnings">
                <summary>{sohCurves.data.warnings.length} 个测试文件未能生成曲线</summary>
                <ul>
                  {sohCurves.data.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>

          <section className="sp-panel" aria-labelledby="sp-table-title">
            <div className="sp-heading sp-table-heading">
              <div>
                <h2 id="sp-table-title">测试集预测明细</h2>
                <p className="sp-note">
                  当前显示 {filteredRows.length.toLocaleString()} / {rows.length.toLocaleString()} 条
                </p>
              </div>
              <Button
                leadingVisual={DownloadIcon}
                onClick={() => downloadCsv(selected?.name ?? "单模型预测", rows)}
              >
                下载预测结果 CSV
              </Button>
            </div>
            <div className="sp-table-tools">
              <label>
                搜索电池
                <input
                  value={query}
                  placeholder="电池编号或文件名"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <label>
                筛选
                <select value={rowFilter} onChange={(event) => setRowFilter(event.target.value as RowFilter)}>
                  <option value="all">全部记录</option>
                  <option value="failed">相对误差超过 15%</option>
                  <option value="missing">缺少预测值或真实值</option>
                </select>
              </label>
            </div>
            <div className="sp-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">电池编号</th>
                    <th scope="col">文件名</th>
                    <th scope="col">粒度</th>
                    <th scope="col">真实值（循环次数）</th>
                    <th scope="col">预测值（循环次数）</th>
                    <th scope="col">绝对误差（循环次数）</th>
                    <th scope="col">相对误差</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const relative = relativeError(row)
                    const failed = relative !== null && relative > 0.15 + 1e-12
                    return (
                      <tr key={`${row.id}-${row.fileName}`}>
                        <th scope="row">{row.id}</th>
                        <td>{row.fileName}</td>
                        <td>{row.granularity}</td>
                        <td>{row.target ?? "暂无"}</td>
                        <td>{row.prediction ?? "暂无"}</td>
                        <td>{display(absoluteError(row))}</td>
                        <td className={failed ? "sp-failed" : undefined}>
                          {display(relative, true)}
                          {failed && <small> 超过15%</small>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {!filteredRows.length && <p className="sp-note sp-no-rows">没有符合当前筛选条件的记录。</p>}
          </section>

          {result.data.warnings.length > 0 && (
            <ul className="warning-list">
              {result.data.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
