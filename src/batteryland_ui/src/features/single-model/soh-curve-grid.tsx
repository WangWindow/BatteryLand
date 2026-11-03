import { useState } from "react"
import type { SohCurvesResult } from "../../api/types"
import type { Prediction } from "./data"

const width = 410
const height = 280
const left = 48
const right = 16
const top = 30
const bottom = 48
const groupSize = 4
const colors = ["#0969da", "#f0883e", "#1a7f37", "#cf222e"]

type Curve = SohCurvesResult["items"][number]
type GroupEntry = { curve: Curve; prediction?: Prediction; eol: number }

function curveEol(curve: Curve, prediction: Prediction | undefined): number {
  const candidate = prediction?.target ?? prediction?.prediction
  if (candidate !== null && candidate !== undefined && Number.isFinite(candidate)) return candidate
  return Math.max(0, ...curve.points.map((point) => point.cycle))
}

function groupCurves(curves: Curve[], rows: Prediction[]): GroupEntry[][] {
  const predictionByFile = new Map(rows.map((row) => [row.fileName, row]))
  const sorted = curves
    .map((curve) => {
      const prediction = predictionByFile.get(curve.file_name)
      return { curve, prediction, eol: curveEol(curve, prediction) }
    })
    .sort((first, second) => first.eol - second.eol)
  return Array.from({ length: Math.ceil(sorted.length / groupSize) }, (_, index) =>
    sorted.slice(index * groupSize, (index + 1) * groupSize),
  )
}

function groupTitle(group: GroupEntry[]): string {
  const eols = group.map((entry) => entry.eol).filter(Number.isFinite)
  const minimum = Math.round(Math.min(...eols))
  const maximum = Math.round(Math.max(...eols))
  const range = minimum === maximum ? `${minimum}` : `${minimum}–${maximum}`
  return `EOL ${range} 次 · ${group.length} 块电池`
}

export function SohCurveGrid({ curves, rows }: { curves: SohCurvesResult["items"]; rows: Prediction[] }) {
  const groups = groupCurves(curves, rows)
  const [hiddenFiles, setHiddenFiles] = useState<Set<string>>(() => new Set())

  function toggleCurve(fileName: string) {
    setHiddenFiles((current) => {
      const next = new Set(current)
      if (next.has(fileName)) next.delete(fileName)
      else next.add(fileName)
      return next
    })
  }

  return (
    <section className="sp-soh-scroll" aria-label="SOH 退化曲线，可横向滚动查看更多分组">
      <div className="sp-soh-track">
        {groups.map((group) => {
          const groupKey = group.map((entry) => entry.curve.file_name).join("|")
          const markerCycles = group.flatMap(({ prediction }) =>
            [prediction?.prediction, prediction?.target].filter(
              (value): value is number => value !== null && value !== undefined && Number.isFinite(value),
            ),
          )
          const maxCycle =
            Math.max(
              1,
              ...markerCycles,
              ...group.flatMap(({ curve }) => curve.points.map((point) => point.cycle)),
            ) * 1.04
          const observedSoh = group
            .flatMap(({ curve }) => curve.points.map((point) => point.soh))
            .filter(Number.isFinite)
          const minSoh = Math.min(0.7, ...observedSoh) - 0.01
          const maxSoh = Math.max(1.03, ...observedSoh) + 0.01
          const x = (cycle: number) => left + (cycle / maxCycle) * (width - left - right)
          const y = (soh: number) => top + ((maxSoh - soh) / (maxSoh - minSoh)) * (height - top - bottom)
          const ticks = Array.from({ length: 5 }, (_, index) => minSoh + ((maxSoh - minSoh) * index) / 4)
          return (
            <article className="sp-soh-card sp-soh-group-card" key={groupKey}>
              <h3>{groupTitle(group)}</h3>
              <svg
                viewBox={`0 0 ${width} ${height}`}
                role="img"
                aria-label={`${groupTitle(group)} SOH 退化曲线`}
              >
                {ticks.map((value) => (
                  <g key={value}>
                    <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="sp-soh-grid" />
                    <text x={left - 7} y={y(value) + 4} textAnchor="end">
                      {value.toFixed(2)}
                    </text>
                  </g>
                ))}
                <line x1={left} x2={width - right} y1={y(0.8)} y2={y(0.8)} className="sp-soh-eol" />
                <text x={width - right - 3} y={y(0.8) - 5} textAnchor="end" className="sp-soh-eol-label">
                  EOL = 0.80
                </text>
                {group.map(({ curve, prediction }, index) => {
                  if (hiddenFiles.has(curve.file_name)) return null
                  const color = colors[index]
                  const line = curve.points
                    .map((point, pointIndex) => `${pointIndex ? "L" : "M"} ${x(point.cycle)} ${y(point.soh)}`)
                    .join(" ")
                  return (
                    <g key={curve.file_name} aria-label={`${curve.cell_id} 曲线与 EOL 标记`}>
                      <path d={line} className="sp-soh-line" style={{ stroke: color }}>
                        <title>{curve.cell_id}</title>
                      </path>
                      {prediction?.prediction !== null && prediction?.prediction !== undefined && (
                        <circle cx={x(prediction.prediction)} cy={y(0.8)} r="4" fill={color}>
                          <title>{`${curve.cell_id} 预测 EOL：${prediction.prediction}`}</title>
                        </circle>
                      )}
                      {prediction?.target !== null && prediction?.target !== undefined && (
                        <path
                          d={`M ${x(prediction.target)} ${y(0.8) - 5} l 5 5 l -5 5 l -5 -5 Z`}
                          fill="white"
                          stroke={color}
                          strokeWidth="1.5"
                        >
                          <title>{`${curve.cell_id} 真实 EOL：${prediction.target}`}</title>
                        </path>
                      )}
                    </g>
                  )
                })}
                <text x={(left + width - right) / 2} y={height - 8} textAnchor="middle">
                  循环次数
                </text>
                <text x="13" y={height / 2} textAnchor="middle" transform={`rotate(-90 13 ${height / 2})`}>
                  SOH
                </text>
              </svg>
              <div className="sp-soh-legend sp-soh-group-legend">
                {group.map(({ curve }, index) => {
                  const hidden = hiddenFiles.has(curve.file_name)
                  return (
                    <button
                      type="button"
                      key={curve.file_name}
                      className={hidden ? "sp-soh-legend-hidden" : undefined}
                      aria-pressed={!hidden}
                      aria-label={`${hidden ? "显示" : "隐藏"} ${curve.cell_id}`}
                      title={`${hidden ? "显示" : "隐藏"} ${curve.file_name}`}
                      onClick={() => toggleCurve(curve.file_name)}
                    >
                      <b className="sp-soh-line-key" style={{ background: colors[index] }} />
                      {curve.cell_id}
                    </button>
                  )
                })}
              </div>
              <p className="sp-soh-legend-hint">点击电池图例可隐藏或显示对应曲线和 EOL 标记</p>
              <p className="sp-soh-marker-note">● 预测 EOL　◇ 真实 EOL</p>
            </article>
          )
        })}
      </div>
    </section>
  )
}
