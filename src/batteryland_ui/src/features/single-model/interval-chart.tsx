import { useState } from "react"
import { type Prediction, relativeError, validInterval } from "./data"

export function IntervalChart({ rows }: { rows: Prediction[] }) {
  const [active, setActive] = useState<string | null>(null)
  const cellSpacing = 88
  const chartWidth = Math.max(360, 190 + Math.max(rows.length - 1, 0) * cellSpacing)
  const firstCellX = (chartWidth - Math.max(rows.length - 1, 0) * cellSpacing) / 2
  const ceiling =
    Math.ceil(
      Math.max(
        1,
        ...rows.flatMap((r) => [r.prediction ?? 0, r.target ?? 0, validInterval(r) ? (r.upper ?? 0) : 0]),
      ) / 400,
    ) * 400
  const y = (value: number) => 280 - (value / ceiling) * 240
  const selected = rows.find((row) => row.id === active)
  return (
    <>
      <div className="sp-chart-scroll">
        <svg
          viewBox={`0 0 ${chartWidth} 340`}
          width={chartWidth}
          className="sp-chart sp-interval-chart"
          role="img"
          aria-label="各电池预测值、真实值与预测区间；完整数值见下方明细表"
        >
          <text x="62" y="18" fill="currentColor">
            EOL（循环次数）
          </text>
          {[0, 1, 2, 3, 4].map((i) => {
            const value = (ceiling * i) / 4
            return (
              <g key={i}>
                <line x1="62" x2={chartWidth - 25} y1={y(value)} y2={y(value)} className="sp-grid" />
                <text x="52" y={y(value) + 5} textAnchor="end" fill="currentColor">
                  {value}
                </text>
              </g>
            )
          })}
          {rows.map((row, index) => {
            const x = firstCellX + index * cellSpacing
            const description = `${row.id}：预测 ${row.prediction ?? "暂无"}；真实值 ${row.target ?? "暂无"}；预测区间 ${validInterval(row) ? `${row.lower}～${row.upper}` : "未提供"}`
            return (
              // biome-ignore lint/a11y/useSemanticElements: SVG plot marks cannot contain HTML buttons; keyboard interaction is provided.
              <g
                key={row.id}
                tabIndex={0}
                role="button"
                aria-label={description}
                onFocus={() => setActive(row.id)}
                onBlur={() => setActive(null)}
                onMouseEnter={() => setActive(row.id)}
                onMouseLeave={() => setActive(null)}
                onClick={() => setActive(row.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    setActive(row.id)
                  }
                }}
              >
                <title>{description}</title>
                <rect
                  x={x - 35}
                  y="30"
                  width="70"
                  height="260"
                  fill={active === row.id ? "var(--bgColor-muted, #f6f8fa)" : "transparent"}
                />
                {validInterval(row) && (
                  <path
                    d={`M ${x} ${y(row.lower as number)} V ${y(row.upper as number)} M ${x - 7} ${y(row.lower as number)} H ${x + 7} M ${x - 7} ${y(row.upper as number)} H ${x + 7}`}
                    stroke="#218bff"
                    strokeWidth="2"
                    fill="none"
                  />
                )}
                {row.prediction !== null && <circle cx={x} cy={y(row.prediction)} r="6" fill="#0969da" />}
                {row.target !== null && (
                  <path d={`M ${x} ${y(row.target) - 7} l 7 7 l -7 7 l -7 -7 Z`} fill="#f0883e" />
                )}
                <text x={x} y="305" textAnchor="middle" fill="currentColor">
                  {row.id}
                </text>
              </g>
            )
          })}
          <text x={chartWidth / 2} y="333" textAnchor="middle" fill="currentColor">
            电池编号
          </text>
        </svg>
      </div>
      <div className="sp-legend">
        <span>
          <b className="sp-blue">●</b> 预测值
        </span>
        <span>
          <b className="sp-orange">◆</b> 真实值
        </span>
        <span>
          <b className="sp-blue">↕</b> 预测区间
        </span>
      </div>
      <div className="sp-hover" aria-live="polite">
        {selected
          ? `${selected.id} · 预测 ${selected.prediction ?? "暂无"} · 真实值 ${selected.target ?? "暂无"} · 预测区间 ${validInterval(selected) ? `${selected.lower}～${selected.upper}` : "未提供"} · 相对误差 ${relativeError(selected) === null ? "无法计算" : `${((relativeError(selected) ?? 0) * 100).toFixed(2)}%`}`
          : "悬停或使用 Tab 聚焦电池，查看具体数值。"}
      </div>
    </>
  )
}
