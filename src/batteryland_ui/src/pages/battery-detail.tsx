import { ArrowLeftIcon } from "@primer/octicons-react"
import { Button, SegmentedControl, TextInput } from "@primer/react"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { Link, useLocation, useParams } from "react-router-dom"
import { api } from "../api/client"
import type { BatteryAnalysis, Chart, CycleSamples } from "../api/types"
import { BatteryCapacityChart } from "../components/battery-capacity-chart"
import { ChartView } from "../components/chart-view"
import { Empty, ErrorNotice, Loading, PageHeader } from "../components/common"
import { display, number } from "../lib/format"

type Unit = "relative" | "ah"
const metadataFields = [
  ["cell_id", "原始电池 ID"],
  ["form_factor", "电池形态"],
  ["cathode_material", "正极材料"],
  ["anode_material", "负极材料"],
  ["electrolyte_material", "电解液材料"],
  ["nominal_capacity_in_Ah", "标称容量（Ah）"],
  ["SOC_interval", "SOC 区间（原值）"],
  ["depth_of_charge", "充电深度（原值）"],
  ["depth_of_discharge", "放电深度（原值）"],
  ["already_spent_cycles", "已有 Cycle 数"],
  ["min_voltage_limit_in_V", "电压下限（V）"],
  ["max_voltage_limit_in_V", "电压上限（V）"],
  ["min_current_limit_in_A", "电流下限（A）"],
  ["max_current_limit_in_A", "电流上限（A）"],
] as const
const protocolFields = [
  ["rate_in_C", "倍率", "C"],
  ["current_in_A", "电流", "A"],
  ["voltage_in_V", "电压", "V"],
  ["power_in_W", "功率", "W"],
  ["start_voltage_in_V", "起始电压", "V"],
  ["end_voltage_in_V", "结束电压", "V"],
  ["start_soc", "起始 SOC", ""],
  ["end_soc", "结束 SOC", ""],
] as const

function valueText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "未提供"
  if (typeof value === "number") return number(value)
  if (Array.isArray(value)) return value.map((item) => valueText(item)).join(" – ")
  return display(value)
}

function Protocol({ title, value }: { title: string; value: unknown }) {
  if (value === null || value === undefined) {
    return (
      <div className="battery-protocol">
        <strong>{title}</strong>
        <span>未提供</span>
      </div>
    )
  }
  if (
    !Array.isArray(value) ||
    !value.every((stage) => stage && typeof stage === "object" && !Array.isArray(stage))
  ) {
    return (
      <div className="battery-protocol">
        <strong>{title}</strong>
        <span>结构待核对</span>
      </div>
    )
  }
  const occurrences = new Map<string, number>()
  return (
    <div className="battery-protocol">
      <strong>{title}</strong>
      <ol>
        {value.map((stage, index) => {
          const identity = JSON.stringify(stage)
          const occurrence = occurrences.get(identity) ?? 0
          occurrences.set(identity, occurrence + 1)
          const record = stage as Record<string, unknown>
          const parts = protocolFields.flatMap(([key, label, unit]) =>
            record[key] === null || record[key] === undefined
              ? []
              : [`${label} ${valueText(record[key])}${unit}`],
          )
          return (
            <li key={`${identity}:${occurrence}`}>
              阶段 {index + 1}：{parts.length ? parts.join(" · ") : "字段未提供"}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function sampleChart(samples: CycleSamples, title: string, unit: string, columns: number[]): Chart {
  const xLabel = samples.time_unit === "min" ? "时间" : "采样序号"
  const xUnit = samples.time_unit === "min" ? "分钟" : ""
  const names = ["", "电压", "电流", "充电容量", "放电容量", "温度"]
  return {
    id: title,
    kind: "line",
    title,
    x_axis: { label: xLabel, unit: xUnit, value_type: "number" },
    y_axis: { label: title, unit, value_type: "number" },
    series: columns.map((column) => ({
      id: String(column),
      label: names[column],
      points: samples.points
        .filter((row) => row[0] !== null)
        .map((row) => ({
          x: Number(row[0]),
          y: typeof row[column] === "number" ? row[column] : null,
        })),
    })),
    warnings: [],
  }
}

function nextRecorded(analysis: BatteryAnalysis, index: number, direction: -1 | 1): number {
  const next = index + direction
  return Math.max(0, Math.min(analysis.cycles.length - 1, next))
}

export default function BatteryDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { search } = useLocation()
  const [unit, setUnit] = useState<Unit>("relative")
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [cycleInput, setCycleInput] = useState("")
  const [inputMessage, setInputMessage] = useState("")
  const summary = useQuery({
    queryKey: ["battery-analysis", id],
    queryFn: ({ signal }) => api.batteryAnalysis(id ?? "", signal),
    enabled: Boolean(id),
  })
  const analysis = summary.data

  useEffect(() => {
    if (!analysis) return
    const first =
      analysis.cycles.find((row) => row.number !== null && row.discharge_capacity_ah !== null) ??
      analysis.cycles[0]
    setSelectedIndex(first?.index ?? null)
    setCycleInput(first?.number === null || first === undefined ? "" : String(first.number))
    setInputMessage("")
  }, [analysis])

  const samples = useQuery({
    queryKey: ["battery-cycle", id, selectedIndex],
    queryFn: ({ signal }) => api.batteryCycle(id ?? "", selectedIndex ?? -1, signal),
    enabled: Boolean(id) && selectedIndex !== null,
  })

  function select(index: number) {
    if (!analysis?.cycles[index]) return
    setSelectedIndex(index)
    setCycleInput(analysis.cycles[index].number === null ? "" : String(analysis.cycles[index].number))
    setInputMessage("")
  }

  function findCycle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!analysis) return
    const target = Number(cycleInput)
    if (!Number.isInteger(target) || !cycleInput.trim()) {
      setInputMessage("请输入实际记录中的整数 Cycle 编号。")
      return
    }
    const matches = analysis.cycles.filter((row) => row.number === target)
    if (!matches.length) {
      setInputMessage(`未找到 Cycle ${target} 的详细记录；不会补造缺失编号。`)
      return
    }
    select(matches[0].index)
    if (matches.length > 1) {
      setInputMessage(
        `Cycle ${target} 在文件中出现 ${matches.length} 次，当前显示第一条记录。可用“下一条记录”查看其余记录。`,
      )
    }
  }

  const selected = selectedIndex === null ? null : analysis?.cycles[selectedIndex]
  const maxRecorded = analysis?.max_recorded_cycle
  const labelBeyond =
    analysis?.life_label !== null &&
    analysis?.life_label !== undefined &&
    maxRecorded !== null &&
    maxRecorded !== undefined &&
    analysis.life_label > maxRecorded
  const selectedHasPoint =
    unit === "ah" ? selected?.discharge_capacity_ah !== null : selected?.relative_capacity_percent !== null

  return (
    <>
      <PageHeader
        title={analysis?.file_name ?? "电池详情"}
        description="BatteryLife 原始记录 · 只读浏览"
        actions={
          <Link className="battery-back-link" to={`/data-layer/batteries${search}`}>
            <ArrowLeftIcon /> 返回数据层电池列表
          </Link>
        }
      />
      <ErrorNotice error={summary.error} />
      {summary.isPending ? (
        <Loading label="正在读取电池详细记录" />
      ) : !analysis ? (
        <Empty title="无法显示这块电池" />
      ) : (
        <>
          <section className="battery-detail-panel">
            <h2>电池与测试条件</h2>
            <div className="battery-detail-metrics">
              <div>
                <span>数据来源</span>
                <strong>{analysis.source_name}</strong>
              </div>
              <div>
                <span>详细记录</span>
                <strong>{number(analysis.cycle_count)} 圈</strong>
              </div>
              <div>
                <span>实际记录范围</span>
                <strong>
                  Cycle {valueText(analysis.first_recorded_cycle)} – {valueText(analysis.last_recorded_cycle)}
                </strong>
              </div>
              <div>
                <span>数据集原有 EOL 标签</span>
                <strong>
                  {analysis.life_label === null ? "未提供" : `Cycle ${number(analysis.life_label)}`}
                </strong>
              </div>
            </div>
            {labelBeyond && (
              <p className="battery-detail-note">
                最后一个实际记录编号为 Cycle {number(maxRecorded)}；原有 EOL 标签位于 Cycle{" "}
                {number(analysis.life_label)}。两者之间没有详细容量记录。
              </p>
            )}
            <details className="battery-condition-details">
              <summary>查看原始测试条件</summary>
              <div className="battery-metadata-grid">
                {metadataFields.map(([key, label]) => (
                  <div key={key}>
                    <span>{label}</span>
                    <strong>{valueText(analysis.metadata[key])}</strong>
                  </div>
                ))}
              </div>
              <Protocol title="充电协议" value={analysis.metadata.charge_protocol} />
              <Protocol title="放电协议" value={analysis.metadata.discharge_protocol} />
              <p className="subtle">
                测试条件来自原始文件；原有寿命标签来自 {analysis.life_label_file ?? "未提供的标签文件"}
                。平台已登记的元数据未被改写。
              </p>
            </details>
          </section>

          <section className="battery-detail-panel">
            <div className="battery-panel-heading">
              <div>
                <h2>容量轨迹</h2>
                <p>每个点为该条 Cycle 记录的最大有效放电容量。</p>
              </div>
              <SegmentedControl
                aria-label="容量单位"
                onChange={(index) => setUnit(index === 0 ? "relative" : "ah")}
              >
                <SegmentedControl.Button selected={unit === "relative"}>
                  相对首个有效容量 %
                </SegmentedControl.Button>
                <SegmentedControl.Button selected={unit === "ah"}>容量 Ah</SegmentedControl.Button>
              </SegmentedControl>
            </div>
            <BatteryCapacityChart
              key={analysis.battery_id}
              analysis={analysis}
              unit={unit}
              selectedIndex={selectedIndex}
              onSelect={select}
            />
            <p className="battery-detail-note">
              绿色曲线只连接实际容量记录；绿色虚线标注原有 EOL 标签，红点为当前选中的 Cycle。横轴使用实际
              Cycle
              编号；点击或拖动曲线后松开、聚焦图表后按左右方向键均可选圈。相对容量按首个有效放电容量计算，不代表各来源统一定义的
              SOH。
            </p>
            {selected && !selectedHasPoint && (
              <p className="battery-detail-note">
                所选记录没有有效放电容量，因此图中没有红点；下方仍可查看它的采样。
              </p>
            )}
          </section>

          <section className="battery-detail-panel">
            <div className="battery-panel-heading">
              <div>
                <h2>单个 Cycle 的采样曲线</h2>
                <p>按文件中的记录顺序选圈；实际编号可跳跃或重复。</p>
              </div>
              <form className="battery-cycle-controls" onSubmit={findCycle}>
                <TextInput
                  aria-label="实际 Cycle 编号"
                  type="number"
                  step="1"
                  value={cycleInput}
                  onChange={(event) => setCycleInput(event.target.value)}
                />
                <Button type="submit">查看 Cycle</Button>
              </form>
            </div>
            <div className="battery-cycle-navigation">
              <Button
                size="small"
                disabled={selectedIndex === null || selectedIndex <= 0}
                onClick={() => select(nextRecorded(analysis, selectedIndex ?? 0, -1))}
              >
                上一条记录
              </Button>
              <strong>
                {selected
                  ? `Cycle ${selected.number ?? "编号未提供"} · 文件中第 ${selected.index + 1} 条`
                  : "无记录"}
              </strong>
              <Button
                size="small"
                disabled={selectedIndex === null || selectedIndex >= analysis.cycle_count - 1}
                onClick={() => select(nextRecorded(analysis, selectedIndex ?? 0, 1))}
              >
                下一条记录
              </Button>
            </div>
            {inputMessage && (
              <p className="battery-detail-note" role="status">
                {inputMessage}
              </p>
            )}
            <ErrorNotice error={samples.error} />
            {samples.isFetching ? (
              <Loading label="正在读取该圈采样" />
            ) : samples.data && selectedIndex === samples.data.index ? (
              samples.data.point_count === 0 ? (
                <p className="battery-detail-note">此 Cycle 没有采样点。</p>
              ) : (
                <>
                  <p className="battery-detail-note">
                    该圈原有 {number(samples.data.point_count)} 个采样点，图中显示{" "}
                    {number(samples.data.points.length)} 个；保留首末点，超出展示上限时均匀抽样。横轴为
                    {samples.data.time_unit === "min"
                      ? "相对该圈首个时间戳的分钟数"
                      : "采样序号（没有可靠时间轴）"}
                    。
                  </p>
                  <div className="battery-sample-grid">
                    <ChartView chart={sampleChart(samples.data, "电压", "V", [1])} />
                    <ChartView chart={sampleChart(samples.data, "电流", "A", [2])} />
                    <ChartView chart={sampleChart(samples.data, "充放电容量", "Ah", [3, 4])} />
                  </div>
                </>
              )
            ) : null}
          </section>
        </>
      )}
    </>
  )
}
