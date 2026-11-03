import type { Result } from "../../api/types"
import { type Prediction, relativeError, summarize } from "../single-model/data"

export type ComparedRun = {
  id: string
  name: string
  model: string
  color: string
  rows: Prediction[]
}

export type CommonBattery = {
  key: string
  id: string
  fileName: string
  target: number
  predictions: Record<string, number>
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function rowsFromResult(result: Result | undefined): Prediction[] {
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

function rowKey(row: Prediction): string {
  return row.fileName || row.id
}

export function commonBatteries(runs: ComparedRun[]): CommonBattery[] {
  if (runs.length < 2) return []
  const maps = runs.map(
    (run) =>
      new Map(
        run.rows
          .filter((row) => row.prediction !== null && row.target !== null && row.target > 0)
          .map((row) => [rowKey(row), row]),
      ),
  )
  return [...maps[0].keys()]
    .filter((key) => maps.every((map) => map.has(key)))
    .flatMap((key) => {
      const rows = maps.map((map) => map.get(key) as Prediction)
      const target = rows[0].target as number
      if (rows.some((row) => row.target === null || Math.abs(row.target - target) > 1e-6)) return []
      return [
        {
          key,
          id: rows[0].id,
          fileName: rows[0].fileName,
          target,
          predictions: Object.fromEntries(
            runs.map((run, index) => [run.id, rows[index].prediction as number]),
          ),
        },
      ]
    })
    .sort((first, second) => first.target - second.target || first.fileName.localeCompare(second.fileName))
}

export function rowsForRun(run: ComparedRun, batteries: CommonBattery[]): Prediction[] {
  return batteries.map((battery) => ({
    id: battery.id,
    fileName: battery.fileName,
    prediction: battery.predictions[run.id],
    target: battery.target,
    lower: null,
    upper: null,
    granularity: "mean_by_battery",
  }))
}

export function comparisonSummaries(runs: ComparedRun[], batteries: CommonBattery[]) {
  return runs.map((run) => ({ run, summary: summarize(rowsForRun(run, batteries)) }))
}

export function winnerCounts(runs: ComparedRun[], batteries: CommonBattery[]): Record<string, number> {
  const counts = Object.fromEntries(runs.map((run) => [run.id, 0]))
  for (const battery of batteries) {
    let best = Number.POSITIVE_INFINITY
    let winners: string[] = []
    for (const run of runs) {
      const error = Math.abs(battery.predictions[run.id] - battery.target) / battery.target
      if (error < best - 1e-12) {
        best = error
        winners = [run.id]
      } else if (Math.abs(error - best) <= 1e-12) winners.push(run.id)
    }
    for (const id of winners) counts[id] += 1
  }
  return counts
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function comparisonCsv(runs: ComparedRun[], batteries: CommonBattery[]): string {
  const header = [
    "battery_id",
    "file_name",
    "target",
    ...runs.flatMap((run) => [`${run.name}_prediction`, `${run.name}_relative_error`]),
  ]
  const lines = batteries.map((battery) => [
    battery.id,
    battery.fileName,
    battery.target,
    ...runs.flatMap((run) => {
      const prediction = battery.predictions[run.id]
      const error = relativeError({
        id: battery.id,
        fileName: battery.fileName,
        prediction,
        target: battery.target,
        lower: null,
        upper: null,
        granularity: "mean_by_battery",
      })
      return [prediction, error ?? ""]
    }),
  ])
  return `\uFEFF${[header, ...lines].map((line) => line.map(csvCell).join(",")).join("\n")}`
}
