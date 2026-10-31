import { Button, FormControl, Select } from "@primer/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { api } from "../api/client"
import type { Chart, DomainShiftAnalysis, DomainShiftConfig, DomainShiftDistribution } from "../api/types"
import { ChartView } from "../components/chart-view"
import { Empty, ErrorNotice, Loading, PageHeader } from "../components/common"

type Tab = "overview" | "space" | "shift" | "distribution"
type SourceOption = { id: string; name: string; available_battery_count: number }

const number = (value: number | null | undefined, digits = 3) =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits)

function pcaChart(result: DomainShiftAnalysis): Chart {
  const datasets = new Map<string, DomainShiftAnalysis["pca"]["points"]>()
  for (const point of result.pca.points) {
    const values = datasets.get(point.dataset_name) ?? []
    values.push(point)
    datasets.set(point.dataset_name, values)
  }
  const variance = result.pca.explained_variance
  return {
    id: "domain-pca",
    title: `PCA：PC1 ${((variance[0] ?? 0) * 100).toFixed(1)}%，PC2 ${((variance[1] ?? 0) * 100).toFixed(1)}%`,
    kind: "scatter",
    x_axis: { label: "PC1", value_type: "number", unit: null },
    y_axis: { label: "PC2", value_type: "number", unit: null },
    series: [...datasets].map(([label, values]) => ({
      id: label,
      label,
      points: values.map((point) => ({ x: point.pc1, y: point.pc2 })),
    })),
    warnings: [],
  } as Chart
}

function shiftChart(result: DomainShiftAnalysis): Chart {
  return {
    id: "domain-shift-ranking",
    title: "整体：全部源域 vs 全部目标域",
    kind: "bar",
    x_axis: { label: "特征", value_type: "category", unit: null },
    y_axis: { label: "归一化 Wasserstein 距离", value_type: "number", unit: null },
    series: [
      {
        id: "wd_norm",
        label: "wd_norm",
        points: result.shift.slice(0, 15).map((row) => ({ x: row.feature, y: row.wd_norm })),
      },
    ],
    warnings: [],
  } as Chart
}

function distributionChart(result: DomainShiftDistribution): Chart {
  return {
    id: `distribution-${result.feature}`,
    title: `${result.feature} 分布`,
    kind: "line",
    x_axis: { label: result.feature, value_type: "number", unit: null },
    y_axis: { label: "样本数", value_type: "number", unit: null },
    series: result.series.map((series) => ({
      id: series.key,
      label: series.label,
      points: series.points,
    })),
    warnings: [],
  } as Chart
}

export default function DomainShiftPage() {
  const queryClient = useQueryClient()
  const sources = useQuery({ queryKey: ["sources"], queryFn: ({ signal }) => api.sources(signal) })
  const [sourceIds, setSourceIds] = useState<string[]>([])
  const [targetIds, setTargetIds] = useState<string[]>([])
  const [stride, setStride] = useState(1)
  const [maxCycles, setMaxCycles] = useState(200)
  const [minimumCoverage, setMinimumCoverage] = useState(0.5)
  const [level, setLevel] = useState<"cycle" | "cell">("cycle")
  const [pcaFit, setPcaFit] = useState<"all" | "source">("all")
  const [workers, setWorkers] = useState(4)
  const [seed, setSeed] = useState(42)
  const [jobId, setJobId] = useState("")
  const [tab, setTab] = useState<Tab>("overview")
  const [feature, setFeature] = useState("")
  const [groupBy, setGroupBy] = useState<"dataset" | "domain">("dataset")
  const selected = useMemo(() => [...new Set([...sourceIds, ...targetIds])], [sourceIds, targetIds])
  const config = useMemo<DomainShiftConfig>(
    () => ({
      source_ids: sourceIds,
      target_ids: targetIds,
      stride,
      max_cycles: maxCycles,
      minimum_coverage: minimumCoverage,
      level,
      feature_groups: [],
      excluded_features: [],
      seed,
      points_per_dataset: 3000,
      pca_fit: pcaFit,
    }),
    [sourceIds, targetIds, stride, maxCycles, minimumCoverage, level, seed, pcaFit],
  )
  const cache = useQuery({
    queryKey: ["domain-shift-cache", selected, stride],
    queryFn: () => api.domainShiftCacheStatus(selected, stride),
    enabled: selected.length > 0,
  })
  const build = useMutation({
    mutationFn: () => api.startDomainShiftBuild(selected, stride, workers),
    onSuccess: (job) => setJobId(job.id),
  })
  const job = useQuery({
    queryKey: ["domain-shift-job", jobId],
    queryFn: ({ signal }) => api.domainShiftJob(jobId, signal),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const state = query.state.data?.state
      return state && ["completed", "completed_with_errors", "failed"].includes(state) ? false : 1000
    },
  })
  useEffect(() => {
    if (job.data && ["completed", "completed_with_errors"].includes(job.data.state)) {
      void queryClient.invalidateQueries({ queryKey: ["domain-shift-cache"] })
    }
  }, [job.data, queryClient])
  const analyze = useMutation({
    mutationFn: (override?: DomainShiftConfig) =>
      api.domainShiftAnalysis(override ?? config),
  })
  useEffect(() => {
    if (analyze.data?.features.length && !analyze.data.features.some((item) => item.name === feature)) {
      setFeature(analyze.data.features[0].name)
    }
  }, [analyze.data, feature])
  const distribution = useQuery({
    queryKey: ["domain-shift-distribution", config, feature, groupBy],
    queryFn: () =>
      api.domainShiftDistribution({ ...config, feature, group_by: groupBy, bins: 40, clip: true }),
    enabled: Boolean(analyze.data && feature && tab === "distribution"),
  })
  const sourceOptions = sources.data?.items ?? []
  const ready = Boolean(sourceIds.length && targetIds.length && cache.data?.missing_files === 0)
  const error =
    sources.error ?? cache.error ?? build.error ?? job.error ?? analyze.error ?? distribution.error

  return (
    <>
      <PageHeader
        title="电池域差异分析"
        description="比较源域与目标域的循环级物理特征分布，支持 PCA、Wasserstein 距离和单特征分布分析。"
      />
      <ErrorNotice error={error} />
      {sources.isPending ? (
        <Loading />
      ) : (
        <div className="domain-shift-layout">
          <aside className="domain-shift-config">
            <div className="section-title">
              <h2>分析设置</h2>
              <span className="subtle">源域和目标域均可多选</span>
            </div>
            <FormControl>
              <FormControl.Label>源域数据集</FormControl.Label>
              <DatasetChecklist
                items={sourceOptions}
                selected={sourceIds}
                blocked={targetIds}
                onChange={setSourceIds}
              />
            </FormControl>
            <FormControl>
              <FormControl.Label>目标域数据集</FormControl.Label>
              <DatasetChecklist
                items={sourceOptions}
                selected={targetIds}
                blocked={sourceIds}
                onChange={setTargetIds}
              />
            </FormControl>
            <div className="domain-field-grid">
              <FormControl>
                <FormControl.Label>
                  <FieldLabel
                    text="每 N 个循环取 1 个"
                    help="1 = 使用全部循环。增大 N 可加快提取；改变步长会使用一套独立的特征缓存。"
                  />
                </FormControl.Label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={stride}
                  onChange={(event) => setStride(Number(event.target.value))}
                />
              </FormControl>
              <FormControl>
                <FormControl.Label>
                  <FieldLabel
                    text="每电池最多循环数"
                    help="0 = 不限。超过上限时沿电池寿命等间隔抽取，避免长寿命电池主导整体分布。"
                  />
                </FormControl.Label>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  value={maxCycles}
                  onChange={(event) => setMaxCycles(Number(event.target.value))}
                />
              </FormControl>
              <FormControl>
                <FormControl.Label>
                  <FieldLabel
                    text="最低覆盖率"
                    help="要求每个所选数据集都达到该非空比例。覆盖不足的特征会被剔除，避免缺失值填补影响结果。"
                  />
                </FormControl.Label>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={minimumCoverage}
                  onChange={(event) => setMinimumCoverage(Number(event.target.value))}
                />
              </FormControl>
              <FormControl>
                <FormControl.Label>并行进程数</FormControl.Label>
                <input
                  type="number"
                  min={1}
                  max={32}
                  value={workers}
                  onChange={(event) => setWorkers(Number(event.target.value))}
                />
              </FormControl>
            </div>
            <FormControl>
              <FormControl.Label>随机种子</FormControl.Label>
              <input
                type="number"
                min={0}
                max={99999}
                value={seed}
                onChange={(event) => setSeed(Number(event.target.value))}
              />
            </FormControl>
            <FormControl>
              <FormControl.Label>分析粒度</FormControl.Label>
              <Select value={level} onChange={(event) => setLevel(event.target.value as "cycle" | "cell")}>
                <Select.Option value="cycle">循环级</Select.Option>
                <Select.Option value="cell">电池级（每电池取中位数）</Select.Option>
              </Select>
            </FormControl>
            {selected.length > 0 && (
              <section className="cache-status">
                <strong>特征缓存</strong>
                {cache.isPending ? (
                  <span className="subtle">正在检查…</span>
                ) : (
                  <>
                    {cache.data?.items.map((item) => (
                      <span key={item.source_id}>
                        {item.name}：{item.cached_files}/{item.total_files}
                      </span>
                    ))}
                    {job.data && ["queued", "running"].includes(job.data.state) && (
                      <progress max={Math.max(job.data.total, 1)} value={job.data.done} />
                    )}
                    {job.data?.error && <span className="danger">{job.data.error}</span>}
                  </>
                )}
              </section>
            )}
            {cache.data?.missing_files ? (
              <Button
                variant="primary"
                loading={build.isPending}
                disabled={!selected.length}
                onClick={() => build.mutate()}
              >
                提取剩余 {cache.data.missing_files} 个文件的特征
              </Button>
            ) : (
              <Button
                variant="primary"
                loading={analyze.isPending}
                disabled={!ready}
                onClick={() => analyze.mutate()}
              >
                开始分析
              </Button>
            )}
          </aside>
          <section className="domain-shift-results">
            {!analyze.data ? (
              <Empty title="选择源域和目标域后开始分析">
                <p>首次分析需要先提取并缓存循环特征，后续可直接复用。</p>
              </Empty>
            ) : (
              <DomainResults
                result={analyze.data}
                tab={tab}
                setTab={setTab}
                feature={feature}
                setFeature={setFeature}
                groupBy={groupBy}
                setGroupBy={setGroupBy}
                pcaFit={pcaFit}
                setPcaFit={(value) => {
                  setPcaFit(value)
                  analyze.mutate({ ...config, pca_fit: value })
                }}
                analyzing={analyze.isPending}
                distribution={distribution.data}
                distributionLoading={distribution.isPending}
              />
            )}
          </section>
        </div>
      )}
    </>
  )
}

function DomainResults({
  result,
  tab,
  setTab,
  feature,
  setFeature,
  groupBy,
  setGroupBy,
  pcaFit,
  setPcaFit,
  analyzing,
  distribution,
  distributionLoading,
}: {
  result: DomainShiftAnalysis
  tab: Tab
  setTab: (tab: Tab) => void
  feature: string
  setFeature: (feature: string) => void
  groupBy: "dataset" | "domain"
  setGroupBy: (value: "dataset" | "domain") => void
  pcaFit: "all" | "source"
  setPcaFit: (value: "all" | "source") => void
  analyzing: boolean
  distribution?: DomainShiftDistribution
  distributionLoading: boolean
}) {
  const tabs: [Tab, string][] = [
    ["overview", "数据概览"],
    ["space", "特征空间"],
    ["shift", "特征差异"],
    ["distribution", "单特征分布"],
  ]
  return (
    <>
      <div className="tabs domain-tabs" role="tablist">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "overview" && (
        <>
          <div className="domain-metrics">
            <Metric label="源域数据集" value={result.summary.source_count} />
            <Metric label="目标域数据集" value={result.summary.target_count} />
            <Metric label="参与比较的特征" value={result.summary.feature_count} />
            <Metric label={`分析样本（${result.summary.sample_unit}）`} value={result.summary.sample_count} />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>数据集</th>
                  <th>域</th>
                  <th>电池数</th>
                  <th>分析样本</th>
                  <th>提取循环</th>
                  <th>额定容量 Ah</th>
                  <th>温度覆盖</th>
                </tr>
              </thead>
              <tbody>
                {result.datasets.map((row) => (
                  <tr key={row.source_id}>
                    <td>{row.name}</td>
                    <td>{row.domain}</td>
                    <td>{row.cells}</td>
                    <td>{row.samples}</td>
                    <td>{row.extracted_cycles}</td>
                    <td>{row.nominal_capacity_range}</td>
                    <td>
                      {row.temperature_coverage == null
                        ? "—"
                        : `${(row.temperature_coverage * 100).toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="domain-details">
            <summary>被剔除的特征（{result.dropped_features.length}）</summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>特征</th>
                    <th>原因</th>
                  </tr>
                </thead>
                <tbody>
                  {result.dropped_features.map((row) => (
                    <tr key={row.feature}>
                      <td>{row.feature}</td>
                      <td>{row.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      {tab === "space" && (
        <>
          <div className="domain-space-controls">
            <FormControl>
              <FormControl.Label>PCA 拟合范围</FormControl.Label>
              <Select
                value={pcaFit}
                disabled={analyzing}
                onChange={(event) =>
                  setPcaFit(event.target.value as "all" | "source")
                }
              >
                <Select.Option value="all">全部数据</Select.Option>
                <Select.Option value="source">
                  仅源域（目标域投影进源域空间）
                </Select.Option>
              </Select>
            </FormControl>
          </div>
          <ChartView chart={pcaChart(result)} />
          <div className="domain-loading-grid">
            {Object.entries(result.pca.loadings).map(([component, rows]) => (
              <section key={component}>
                <h3>{component} 主要贡献特征</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>特征</th>
                        <th>载荷</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.feature}>
                          <td>{row.feature}</td>
                          <td>{number(row.loading, 4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        </>
      )}
      {tab === "shift" && (
        <>
          <ChartView chart={shiftChart(result)} />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>特征</th>
                  <th>分组</th>
                  <th>wd_norm</th>
                  <th>smd</th>
                  <th>源域均值</th>
                  <th>目标域均值</th>
                </tr>
              </thead>
              <tbody>
                {result.shift.map((row) => (
                  <tr key={row.feature}>
                    <td>{row.feature}</td>
                    <td>{row.group}</td>
                    <td>{number(row.wd_norm)}</td>
                    <td>{number(row.smd)}</td>
                    <td>{number(row.source_mean)}</td>
                    <td>{number(row.target_mean)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="domain-subheading">数据集两两比较</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>源域数据集</th>
                  <th>目标域数据集</th>
                  <th>平均距离</th>
                </tr>
              </thead>
              <tbody>
                {result.pairwise.map((row) => (
                  <tr key={`${row.source_id}:${row.target_id}`}>
                    <td>{row.source_name}</td>
                    <td>{row.target_name}</td>
                    <td>{number(row.mean_distance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab === "distribution" && (
        <>
          <div className="domain-distribution-controls">
            <FormControl>
              <FormControl.Label>特征</FormControl.Label>
              <Select value={feature} onChange={(event) => setFeature(event.target.value)}>
                {result.features.map((item) => (
                  <Select.Option key={item.name} value={item.name}>
                    {item.name} · {item.group}
                  </Select.Option>
                ))}
              </Select>
            </FormControl>
            <FormControl>
              <FormControl.Label>分组</FormControl.Label>
              <Select
                value={groupBy}
                onChange={(event) => setGroupBy(event.target.value as "dataset" | "domain")}
              >
                <Select.Option value="dataset">数据集</Select.Option>
                <Select.Option value="domain">域</Select.Option>
              </Select>
            </FormControl>
          </div>
          {distributionLoading || !distribution ? (
            <Loading />
          ) : (
            <>
              <ChartView chart={distributionChart(distribution)} />
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>数据集</th>
                      <th>样本数</th>
                      <th>均值</th>
                      <th>标准差</th>
                      <th>最小值</th>
                      <th>中位数</th>
                      <th>最大值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {distribution.statistics.map((row) => (
                      <tr key={row.source_id}>
                        <td>{row.name}</td>
                        <td>{row.count}</td>
                        <td>{number(row.mean)}</td>
                        <td>{number(row.std)}</td>
                        <td>{number(row.min)}</td>
                        <td>{number(row.median)}</td>
                        <td>{number(row.max)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <section className="domain-metric">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </section>
  )
}

function FieldLabel({ text, help }: { text: string; help: string }) {
  return (
    <span className="domain-field-label">
      <span>{text}</span>
      <button
        type="button"
        className="domain-help"
        aria-label={`${text}说明：${help}`}
        data-tooltip={help}
        onClick={(event) => event.preventDefault()}
      >
        ?
      </button>
    </span>
  )
}

function DatasetChecklist({
  items,
  selected,
  blocked,
  onChange,
}: {
  items: SourceOption[]
  selected: string[]
  blocked: string[]
  onChange: (ids: string[]) => void
}) {
  const available = items.filter((item) => !blocked.includes(item.id))
  const allSelected = available.length > 0 && available.every((item) => selected.includes(item.id))
  const toggle = (id: string, checked: boolean) =>
    onChange(checked ? [...new Set([...selected, id])] : selected.filter((item) => item !== id))

  return (
    <div className="dataset-checklist">
      <div className="dataset-checklist-actions">
        <label>
          <input
            type="checkbox"
            checked={allSelected}
            disabled={!available.length}
            onChange={() => onChange(allSelected ? [] : available.map((item) => item.id))}
          />
          <span>Select all（全选）</span>
        </label>
        <button type="button" disabled={!selected.length} onClick={() => onChange([])}>
          清空
        </button>
      </div>
      <div className="dataset-checklist-items">
        {items.map((item) => {
          const disabled = blocked.includes(item.id)
          return (
            <label key={item.id} className={disabled ? "is-disabled" : undefined}>
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                disabled={disabled}
                onChange={(event) => toggle(item.id, event.target.checked)}
              />
              <span>{item.name}</span>
              <small>{item.available_battery_count} 个电池</small>
            </label>
          )
        })}
      </div>
    </div>
  )
}
