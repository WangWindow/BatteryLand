import { useMemo, useState } from "react"
import type { CommonBattery, ComparedRun } from "./data"

type SortMode = "target" | "max-error"

function relativeError(battery: CommonBattery, run: ComparedRun): number {
  return Math.abs(battery.predictions[run.id] - battery.target) / battery.target
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

export function ErrorHeatmap({ runs, batteries }: { runs: ComparedRun[]; batteries: CommonBattery[] }) {
  const [sortMode, setSortMode] = useState<SortMode>("target")
  const ordered = useMemo(() => {
    const copy = [...batteries]
    if (sortMode === "max-error") {
      return copy.sort((first, second) => {
        const firstMax = Math.max(...runs.map((run) => relativeError(first, run)))
        const secondMax = Math.max(...runs.map((run) => relativeError(second, run)))
        return secondMax - firstMax || first.target - second.target
      })
    }
    return copy.sort(
      (first, second) => first.target - second.target || first.fileName.localeCompare(second.fileName),
    )
  }, [batteries, runs, sortMode])

  return (
    <div className="mm-heatmap-section">
      <div className="mm-heatmap-toolbar">
        <label>
          电池排序
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
            <option value="target">按真实寿命升序</option>
            <option value="max-error">按最大误差降序</option>
          </select>
        </label>
      </div>

        <div className="mm-table-scroll mm-error-table-wrap">
          <table className="mm-error-table">
            <thead>
              <tr>
                <th>测试电池</th>
                <th>真实EOL</th>
                {runs.map((run) => (
                  <th key={run.id}>
                    {run.model}
                    <small>预测值 / 相对误差</small>
                  </th>
                ))}
                <th>最优模型</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((battery) => {
                const errors = runs.map((run) => ({ run, value: relativeError(battery, run) }))
                const best = Math.min(...errors.map((item) => item.value))
                const winners = errors.filter((item) => Math.abs(item.value - best) <= 1e-12)
                return (
                  <tr key={battery.key}>
                    <th title={battery.fileName}>{battery.id}</th>
                    <td>{battery.target.toFixed(0)}</td>
                    {errors.map(({ run, value }) => (
                      <td
                        key={run.id}
                        className={Math.abs(value - best) <= 1e-12 ? "is-row-best" : undefined}
                      >
                        <strong>{battery.predictions[run.id].toFixed(2)}</strong>
                        <small>{percent(value)}</small>
                      </td>
                    ))}
                    <td>{winners.map((item) => item.run.model).join("、")}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
    </div>
  )
}
