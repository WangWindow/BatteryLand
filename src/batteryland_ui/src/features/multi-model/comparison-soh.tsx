import { useState } from "react"
import type { SohCurvesResult } from "../../api/types"
import type { CommonBattery, ComparedRun } from "./data"

const width = 500
const height = 300
const left = 52
const right = 18
const top = 30
const bottom = 48
const groupSize = 4
const batteryColors = ["#0969da", "#f0883e", "#1a7f37", "#cf222e"]

function marker(shape: number, x: number, y: number, color: string, key: string, title: string) {
  if (shape === 1)
    return (
      <path key={key} d={`M ${x} ${y - 5} l 5 9 h -10 Z`} fill={color} className="mm-eol-marker">
        <title>{title}</title>
      </path>
    )
  if (shape === 2)
    return (
      <rect key={key} x={x - 4} y={y - 4} width="8" height="8" fill={color} className="mm-eol-marker">
        <title>{title}</title>
      </rect>
    )
  if (shape === 3)
    return (
      <path
        key={key}
        d={`M ${x - 5} ${y - 5} L ${x + 5} ${y + 5} M ${x + 5} ${y - 5} L ${x - 5} ${y + 5}`}
        stroke={color}
        strokeWidth="2.5"
        className="mm-eol-marker"
      >
        <title>{title}</title>
      </path>
    )
  return (
    <circle key={key} cx={x} cy={y} r="4.5" fill={color} className="mm-eol-marker">
      <title>{title}</title>
    </circle>
  )
}

function shapeSymbol(index: number): string {
  return ["●", "▲", "■", "×"][index] ?? "●"
}

export function ComparisonSoh({
  curves,
  batteries,
  runs,
}: {
  curves: SohCurvesResult["items"]
  batteries: CommonBattery[]
  runs: ComparedRun[]
}) {
  const [hiddenModels, setHiddenModels] = useState<Set<string>>(() => new Set())
  const [hiddenBatteries, setHiddenBatteries] = useState<Set<string>>(() => new Set())
  const batteryByFile = new Map(batteries.map((battery) => [battery.fileName, battery]))
  const entries = curves
    .flatMap((curve) => {
      const battery = batteryByFile.get(curve.file_name)
      return battery ? [{ curve, battery }] : []
    })
    .sort((first, second) => first.battery.target - second.battery.target)
  const groups = Array.from({ length: Math.ceil(entries.length / groupSize) }, (_, index) =>
    entries.slice(index * groupSize, (index + 1) * groupSize),
  )

  function toggle(setter: typeof setHiddenModels, id: string) {
    setter((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div>
      <fieldset className="mm-model-marker-legend" aria-label="模型预测标记图例">
        {runs.map((run, index) => (
          <button
            type="button"
            key={run.id}
            className={hiddenModels.has(run.id) ? "is-hidden" : undefined}
            aria-pressed={!hiddenModels.has(run.id)}
            onClick={() => toggle(setHiddenModels, run.id)}
          >
            <b>{shapeSymbol(index)}</b>
            {run.name}
          </button>
        ))}
        <span>◇ 真实EOL</span>
      </fieldset>
      <section className="mm-soh-scroll" aria-label="多模型SOH曲线，可横向滚动查看更多分组">
        <div className="mm-soh-track">
          {groups.map((group) => {
            const key = group.map((entry) => entry.curve.file_name).join("|")
            const targets = group.map((entry) => entry.battery.target)
            const title = `EOL ${Math.round(Math.min(...targets))}–${Math.round(Math.max(...targets))} 次 · ${group.length} 块电池`
            const cycleValues = group.flatMap((entry) => [
              ...entry.curve.points.map((point) => point.cycle),
              entry.battery.target,
              ...runs.map((run) => entry.battery.predictions[run.id]),
            ])
            const maxCycle = Math.max(1, ...cycleValues) * 1.04
            const sohValues = group.flatMap((entry) => entry.curve.points.map((point) => point.soh))
            const minSoh = Math.min(0.7, ...sohValues) - 0.01
            const maxSoh = Math.max(1.03, ...sohValues) + 0.01
            const x = (cycle: number) => left + (cycle / maxCycle) * (width - left - right)
            const y = (soh: number) => top + ((maxSoh - soh) / (maxSoh - minSoh)) * (height - top - bottom)
            const ticks = Array.from({ length: 5 }, (_, index) => minSoh + ((maxSoh - minSoh) * index) / 4)
            return (
              <article className="mm-soh-card" key={key}>
                <h3>{title}</h3>
                <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} 多模型EOL对比`}>
                  {ticks.map((value) => (
                    <g key={value}>
                      <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="mm-grid" />
                      <text x={left - 7} y={y(value) + 4} textAnchor="end">
                        {value.toFixed(2)}
                      </text>
                    </g>
                  ))}
                  <line x1={left} x2={width - right} y1={y(0.8)} y2={y(0.8)} className="mm-eol-line" />
                  <text x={width - right - 3} y={y(0.8) - 6} textAnchor="end" className="mm-eol-label">
                    EOL = 0.80
                  </text>
                  {group.map(({ curve, battery }, batteryIndex) => {
                    if (hiddenBatteries.has(curve.file_name)) return null
                    const color = batteryColors[batteryIndex]
                    const line = curve.points
                      .map((point, index) => `${index ? "L" : "M"} ${x(point.cycle)} ${y(point.soh)}`)
                      .join(" ")
                    return (
                      <g key={curve.file_name} aria-label={`${curve.cell_id} 曲线与多模型EOL标记`}>
                        <path d={line} className="mm-soh-line" style={{ stroke: color }}>
                          <title>{curve.cell_id}</title>
                        </path>
                        <path
                          d={`M ${x(battery.target)} ${y(0.8) - 5} l 5 5 l -5 5 l -5 -5 Z`}
                          fill="white"
                          stroke={color}
                          strokeWidth="1.8"
                        >
                          <title>{`${curve.cell_id} 真实EOL：${battery.target}`}</title>
                        </path>
                        {runs.flatMap((run, modelIndex) =>
                          hiddenModels.has(run.id)
                            ? []
                            : [
                                marker(
                                  modelIndex,
                                  x(battery.predictions[run.id]),
                                  y(0.8),
                                  color,
                                  `${curve.file_name}-${run.id}`,
                                  `${curve.cell_id} · ${run.name}预测EOL：${battery.predictions[run.id].toFixed(2)}`,
                                ),
                              ],
                        )}
                      </g>
                    )
                  })}
                  <text x={(left + width - right) / 2} y={height - 8} textAnchor="middle">
                    循环次数
                  </text>
                  <text x="14" y={height / 2} textAnchor="middle" transform={`rotate(-90 14 ${height / 2})`}>
                    SOH
                  </text>
                </svg>
                <div className="mm-battery-legend">
                  {group.map(({ curve }, index) => (
                    <button
                      type="button"
                      key={curve.file_name}
                      className={hiddenBatteries.has(curve.file_name) ? "is-hidden" : undefined}
                      aria-pressed={!hiddenBatteries.has(curve.file_name)}
                      aria-label={`${hiddenBatteries.has(curve.file_name) ? "显示" : "隐藏"} ${curve.cell_id}`}
                      onClick={() => toggle(setHiddenBatteries, curve.file_name)}
                    >
                      <i style={{ background: batteryColors[index] }} />
                      {curve.cell_id}
                    </button>
                  ))}
                </div>
                <p>颜色区分电池，标记形状区分模型；点击图例可隐藏或显示。</p>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
