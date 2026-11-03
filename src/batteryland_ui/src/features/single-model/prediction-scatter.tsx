import { useId, useState } from "react"
import type { Prediction } from "./data"

export function PredictionScatter({ rows }: { rows: Prediction[] }) {
  const [active, setActive] = useState<string | null>(null)
  const clipId = `sp-accuracy-band-${useId().replaceAll(":", "")}`
  const points = rows.filter(
    (row): row is Prediction & { prediction: number; target: number } =>
      row.prediction !== null &&
      Number.isFinite(row.prediction) &&
      row.target !== null &&
      Number.isFinite(row.target),
  )
  if (!points.length) return <p className="sp-note">没有同时包含真实值和预测值的记录，无法绘制散点图。</p>
  const values = points.flatMap((row) => [row.target, row.prediction])
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const padding = Math.max(
    (rawMax - rawMin) * 0.08,
    rawMax === rawMin ? Math.max(Math.abs(rawMax) * 0.08, 1) : 1,
  )
  const minimum = rawMin - padding
  const maximum = rawMax + padding
  const scaleX = (value: number) => 74 + ((value - minimum) / (maximum - minimum)) * 790
  const scaleY = (value: number) => 300 - ((value - minimum) / (maximum - minimum)) * 250
  const bandValues = Array.from({ length: 65 }, (_, index) => {
    const target = minimum + ((maximum - minimum) * index) / 64
    const firstBoundary = target * 0.85
    const secondBoundary = target * 1.15
    return {
      target,
      lower: Math.min(firstBoundary, secondBoundary),
      upper: Math.max(firstBoundary, secondBoundary),
    }
  })
  const accuracyBandPoints = [
    ...bandValues.map(({ target, upper }) => `${scaleX(target)},${scaleY(upper)}`),
    ...Array.from(bandValues)
      .reverse()
      .map(({ target, lower }) => `${scaleX(target)},${scaleY(lower)}`),
  ].join(" ")
  const selected = points.find((row) => row.id === active)
  return (
    <>
      <div className="sp-chart-scroll">
        <svg
          viewBox="0 0 920 350"
          className="sp-chart"
          role="img"
          aria-label="预测值与真实值散点图，灰色阴影表示理想值上下百分之十五，虚线表示理想预测"
        >
          <defs>
            <clipPath id={clipId}>
              <rect x="74" y="50" width="790" height="250" />
            </clipPath>
          </defs>
          <polygon points={accuracyBandPoints} clipPath={`url(#${clipId})`} className="sp-accuracy-band" />
          {[0, 1, 2, 3, 4].map((index) => {
            const value = minimum + ((maximum - minimum) * index) / 4
            return (
              <g key={index}>
                <line x1={scaleX(value)} x2={scaleX(value)} y1="50" y2="300" className="sp-grid" />
                <line x1="74" x2="864" y1={scaleY(value)} y2={scaleY(value)} className="sp-grid" />
                <text x={scaleX(value)} y="320" textAnchor="middle" fill="currentColor">
                  {value.toFixed(0)}
                </text>
                <text x="64" y={scaleY(value) + 5} textAnchor="end" fill="currentColor">
                  {value.toFixed(0)}
                </text>
              </g>
            )
          })}
          <line
            x1={scaleX(minimum)}
            y1={scaleY(minimum)}
            x2={scaleX(maximum)}
            y2={scaleY(maximum)}
            className="sp-reference"
          />
          {points.map((row) => {
            const description = `${row.id}：真实值 ${row.target}，预测值 ${row.prediction}`
            return (
              // biome-ignore lint/a11y/useSemanticElements: SVG plot marks cannot contain HTML buttons; keyboard interaction is provided.
              <circle
                key={`${row.id}-${row.fileName}`}
                cx={scaleX(row.target)}
                cy={scaleY(row.prediction)}
                r={active === row.id ? 4 : 2}
                className="sp-scatter-point"
                tabIndex={0}
                role="button"
                aria-label={description}
                onFocus={() => setActive(row.id)}
                onBlur={() => setActive(null)}
                onMouseEnter={() => setActive(row.id)}
                onMouseLeave={() => setActive(null)}
              >
                <title>{description}</title>
              </circle>
            )
          })}
          <text x="470" y="345" textAnchor="middle" fill="currentColor">
            真实值（循环次数）
          </text>
          <text x="18" y="175" textAnchor="middle" fill="currentColor" transform="rotate(-90 18 175)">
            预测值（循环次数）
          </text>
        </svg>
      </div>
      <div className="sp-legend">
        <span>
          <b className="sp-blue">●</b> 电池预测
        </span>
        <span>
          <b className="sp-band-key" aria-hidden="true" /> 15%-ACC 区间
        </span>
        <span>
          <b className="sp-gray">━</b> 理想预测 y=x
        </span>
      </div>
      <div className="sp-hover" aria-live="polite">
        {selected
          ? `${selected.id} · 真实值 ${selected.target} · 预测值 ${selected.prediction}`
          : "悬停或使用 Tab 聚焦数据点，查看具体数值。"}
      </div>
    </>
  )
}
