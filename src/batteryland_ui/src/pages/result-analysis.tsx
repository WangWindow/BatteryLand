import { CheckIcon } from "@primer/octicons-react"
import { Button, Checkbox, FormControl, Select } from "@primer/react"
import { useMutation, useQueries, useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../api/client"
import type { Schema } from "../api/types"
import { ChartView } from "../components/chart-view"
import { Empty, ErrorNotice, Loading, PageHeader, StateTag } from "../components/common"
import { date } from "../lib/format"

type ChartType = "metric_bar" | "epoch_line" | "prediction_scatter"
export default function ResultAnalysisPage() {
  const experiments = useQuery({
    queryKey: ["experiments", "compare"],
    queryFn: ({ signal }) => api.experiments({ page_size: 100 }, signal),
  })
  const [selected, setSelected] = useState<string[]>([])
  const [chartType, setChartType] = useState<ChartType>("metric_bar")
  const [metric, setMetric] = useState("")
  const [stage, setStage] = useState<"train" | "validation" | "test">("validation")
  const resultQueries = useQueries({
    queries: selected.map((id) => ({
      queryKey: ["result", id],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.results(id, signal),
    })),
  })
  const availableMetrics = useMemo(
    () =>
      [
        ...new Set(resultQueries.flatMap((query) => query.data?.metrics.map((item) => item.name) ?? [])),
      ].sort(),
    [resultQueries],
  )
  const body = useMemo<Schema["ChartRequest"]>(
    () => ({
      chart_type: chartType,
      experiment_ids: selected,
      ...(chartType === "prediction_scatter" ? {} : { metric, stage }),
    }),
    [chartType, selected, metric, stage],
  )
  const compare = useMutation({
    mutationFn: async () => {
      const [charts, data] = await Promise.all([
        api.charts(body),
        api.compare({ experiment_ids: selected, ...(metric ? { metrics: [metric] } : {}) }),
      ])
      return { charts, data }
    },
  })
  const canRun = selected.length > 0 && (chartType === "prediction_scatter" || Boolean(metric))
  return (
    <>
      <PageHeader
        title="实验结果比较"
        description="可比较不同实验的自定义指标和电池预测值。缺失的指标、真实值或电池会按实际数据呈现。"
      />
      <ErrorNotice error={experiments.error ?? compare.error} />
      {experiments.isPending ? (
        <Loading />
      ) : (
        <div className="compare-layout">
          <aside className="compare-options">
            <div className="section-title">
              <h2>实验</h2>
              <span className="subtle">已选 {selected.length}</span>
            </div>
            <div className="experiment-pick-list">
              {experiments.data?.items.map((item) => (
                <div className="experiment-pick" key={item.id}>
                  <Checkbox
                    aria-label={`选择 ${item.name}`}
                    checked={selected.includes(item.id)}
                    disabled={!selected.includes(item.id) && selected.length >= 8}
                    onChange={(event) =>
                      setSelected((old) =>
                        event.target.checked ? [...old, item.id] : old.filter((value) => value !== item.id),
                      )
                    }
                  />
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      <StateTag state={item.state} /> · {date(item.created_at)}
                    </small>
                  </span>
                </div>
              ))}
            </div>
            <FormControl>
              <FormControl.Label>图表类型</FormControl.Label>
              <Select value={chartType} onChange={(event) => setChartType(event.target.value as ChartType)}>
                <Select.Option value="metric_bar">指标比较</Select.Option>
                <Select.Option value="epoch_line">训练过程</Select.Option>
                <Select.Option value="prediction_scatter">预测值与真实值</Select.Option>
              </Select>
            </FormControl>
            {chartType !== "prediction_scatter" && (
              <>
                <FormControl>
                  <FormControl.Label>指标</FormControl.Label>
                  <Select value={metric} onChange={(event) => setMetric(event.target.value)}>
                    <Select.Option value="">选择结果中存在的指标</Select.Option>
                    {availableMetrics.map((name) => (
                      <Select.Option key={name} value={name}>
                        {name}
                      </Select.Option>
                    ))}
                  </Select>
                </FormControl>
                <FormControl>
                  <FormControl.Label>阶段</FormControl.Label>
                  <Select value={stage} onChange={(event) => setStage(event.target.value as typeof stage)}>
                    <Select.Option value="train">训练</Select.Option>
                    <Select.Option value="validation">验证</Select.Option>
                    <Select.Option value="test">测试</Select.Option>
                  </Select>
                </FormControl>
              </>
            )}
            <Button
              leadingVisual={CheckIcon}
              variant="primary"
              disabled={!canRun}
              loading={compare.isPending}
              onClick={() => compare.mutate()}
            >
              生成图表
            </Button>
            <p className="subtle">
              最多选择 8 个实验。指标选择来自各实验实际结果的并集，未提供的指标不会补零。
            </p>
          </aside>
          <section className="analysis-results">
            <div className="section-title">
              <h2>比较结果</h2>
              {compare.data && (
                <span className="subtle">
                  包含 {compare.data.data.metric_rows.length} 个指标记录与{" "}
                  {compare.data.data.prediction_rows.length} 条预测
                </span>
              )}
            </div>
            {!compare.data ? (
              <Empty title="选择实验并生成图表">
                <p>输出是网页内交互图表，不会生成图片文件。</p>
              </Empty>
            ) : (
              <>
                {compare.data.charts.warnings.length > 0 && (
                  <ul className="warning-list">
                    {compare.data.charts.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
                {compare.data.charts.charts.length ? (
                  compare.data.charts.charts.map((chart) => <ChartView key={chart.id} chart={chart} />)
                ) : (
                  <Empty title="没有可绘制的数据" />
                )}
                {compare.data.data.metric_rows.length > 0 && (
                  <details className="result-data">
                    <summary>指标数据</summary>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>实验</th>
                            <th>阶段</th>
                            <th>指标</th>
                            <th>轮次</th>
                            <th>值</th>
                            <th>单位</th>
                          </tr>
                        </thead>
                        <tbody>
                          {compare.data.data.metric_rows.map((row) => (
                            <tr
                              key={`${row.experiment_id}-${row.name}-${row.stage}-${row.epoch}-${row.granularity}-${row.value}-${row.unit}`}
                            >
                              <td>
                                <Link to={`/experiments/${row.experiment_id}`}>
                                  {experiments.data?.items.find((item) => item.id === row.experiment_id)
                                    ?.name ?? row.experiment_id}
                                </Link>
                              </td>
                              <td>{row.stage}</td>
                              <td>{row.name}</td>
                              <td>{row.epoch ?? "最终"}</td>
                              <td>{row.value ?? "—"}</td>
                              <td>{row.unit || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
                {compare.data.data.prediction_rows.length > 0 && (
                  <details className="result-data">
                    <summary>预测记录</summary>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>实验</th>
                            <th>电池标识</th>
                            <th>预测值</th>
                            <th>真实值</th>
                          </tr>
                        </thead>
                        <tbody>
                          {compare.data.data.prediction_rows.slice(0, 150).map((row) => (
                            <tr
                              key={`${row.experiment_id}-${row.battery_id}-${row.granularity}-${row.prediction}-${row.target}`}
                            >
                              <td>
                                {experiments.data?.items.find((item) => item.id === row.experiment_id)
                                  ?.name ?? row.experiment_id}
                              </td>
                              <td>{row.battery_id}</td>
                              <td>{row.prediction ?? "—"}</td>
                              <td>{row.target ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </>
  )
}
