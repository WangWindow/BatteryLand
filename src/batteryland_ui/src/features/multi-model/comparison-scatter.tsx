import { useState } from "react"
import type { CommonBattery, ComparedRun } from "./data"

const width = 920
const height = 470
const left = 72
const right = 28
const top = 28
const bottom = 64

export function ComparisonScatter({ runs, batteries }: { runs: ComparedRun[]; batteries: CommonBattery[] }) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const values = batteries.flatMap((battery) => [
    battery.target,
    ...runs.map((run) => battery.predictions[run.id]),
  ])
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const padding = Math.max(1, (maximum - minimum) * 0.08)
  const min = Math.max(0, minimum - padding)
  const max = maximum + padding
  const x = (value: number) => left + ((value - min) / (max - min || 1)) * (width - left - right)
  const y = (value: number) => top + ((max - value) / (max - min || 1)) * (height - top - bottom)
  const ticks = Array.from({ length: 5 }, (_, index) => min + ((max - min) * index) / 4)
  const band = `${x(min)},${y(min * 1.15)} ${x(max)},${y(max * 1.15)} ${x(max)},${y(max * 0.85)} ${x(min)},${y(min * 0.85)}`

  function toggle(id: string) {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="mm-chart-shell">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="多模型预测值与真实值对比图">
        <defs>
          <clipPath id="multi-model-scatter-plot">
            <rect x={left} y={top} width={width - left - right} height={height - top - bottom} />
          </clipPath>
        </defs>
        <polygon points={band} className="mm-accuracy-band" clipPath="url(#multi-model-scatter-plot)" />
        {ticks.map((value) => (
          <g key={value}>
            <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="mm-grid" />
            <line x1={x(value)} x2={x(value)} y1={top} y2={height - bottom} className="mm-grid" />
            <text x={left - 9} y={y(value) + 4} textAnchor="end">
              {Math.round(value)}
            </text>
            <text x={x(value)} y={height - bottom + 22} textAnchor="middle">
              {Math.round(value)}
            </text>
          </g>
        ))}
        <line x1={x(min)} y1={y(min)} x2={x(max)} y2={y(max)} className="mm-ideal" />
        {runs.map((run) =>
          hidden.has(run.id)
            ? null
            : batteries.map((battery) => (
                <circle
                  key={`${run.id}-${battery.key}`}
                  cx={x(battery.target)}
                  cy={y(battery.predictions[run.id])}
                  r="4.5"
                  fill={run.color}
                  className="mm-scatter-point"
                >
                  <title>{`${battery.fileName} · ${run.name}：预测 ${battery.predictions[run.id].toFixed(2)}，真实 ${battery.target.toFixed(2)}`}</title>
                </circle>
              )),
        )}
        <text x={(left + width - right) / 2} y={height - 12} textAnchor="middle" className="mm-axis-title">
          真实值（循环次数）
        </text>
        <text
          x="18"
          y={height / 2}
          textAnchor="middle"
          transform={`rotate(-90 18 ${height / 2})`}
          className="mm-axis-title"
        >
          预测值（循环次数）
        </text>
      </svg>
      <fieldset className="mm-chart-legend" aria-label="模型图例">
        {runs.map((run) => (
          <button
            type="button"
            key={run.id}
            className={hidden.has(run.id) ? "is-hidden" : undefined}
            aria-pressed={!hidden.has(run.id)}
            onClick={() => toggle(run.id)}
          >
            <i style={{ background: run.color }} />
            {run.name}
          </button>
        ))}
        <span>
          <i className="mm-band-key" />
          15%-ACC区间
        </span>
        <span>
          <i className="mm-line-key" />
          理想预测 y=x
        </span>
      </fieldset>
      <p className="mm-chart-hint">点击模型图例可隐藏或显示对应预测点；悬停数据点查看具体数值。</p>
    </div>
  )
}
