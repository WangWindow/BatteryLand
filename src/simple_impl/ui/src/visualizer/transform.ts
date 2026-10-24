import type { ChartSpec, Point, Series } from "@/api/models"

export const MAX_CHART_POINTS = 1000

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

export function seriesColor(id: string): string {
  let hash = 0
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }
  return PALETTE[hash % PALETTE.length] ?? PALETTE[0]
}

function evenly(indexes: number[], budget: number): number[] {
  if (budget <= 0) {
    return []
  }
  if (indexes.length <= budget) {
    return indexes
  }
  if (budget === 1) {
    return [indexes[0]].filter((value): value is number => value !== undefined)
  }
  const selected = new Set<number>()
  const step = (indexes.length - 1) / (budget - 1)
  for (let position = 0; position < budget; position += 1) {
    const index = indexes[Math.round(position * step)]
    if (index !== undefined) {
      selected.add(index)
    }
  }
  const ordered = [...selected].sort((left, right) => left - right)
  for (const index of indexes) {
    if (ordered.length >= budget) {
      break
    }
    if (!selected.has(index)) {
      selected.add(index)
      ordered.push(index)
      ordered.sort((left, right) => left - right)
    }
  }
  return ordered.slice(0, budget)
}

/**
 * Downsample one series without interpolating or filling missing values.
 *
 * Null measurements are breakpoints and are retained when the budget allows.
 * The result never exceeds `limit` points and always keeps the first and last
 * non-missing observation when they are within the retained set.
 */
export function sampleSeries(
  points: Point[],
  limit = MAX_CHART_POINTS,
): { points: Point[]; originalCount: number; sampled: boolean } {
  if (points.length <= limit) {
    return { points, originalCount: points.length, sampled: false }
  }
  const missing = points
    .map((point, index) => (point.y === null ? index : -1))
    .filter((index) => index >= 0)
  const present = points
    .map((point, index) => (point.y !== null ? index : -1))
    .filter((index) => index >= 0)

  let keep: number[]
  if (missing.length >= limit) {
    keep = evenly(
      points.map((_, index) => index),
      limit,
    )
  } else {
    const budget = limit - missing.length
    keep = [...missing, ...evenly(present, budget)].sort((left, right) => left - right)
  }
  const selected = new Set(keep)
  return {
    points: points.filter((_, index) => selected.has(index)),
    originalCount: points.length,
    sampled: true,
  }
}

export function sampledSeries(series: Series[]): {
  series: Series[]
  originalCount: number
  sampled: boolean
} {
  const results = series.map((item) => ({ ...item, ...sampleSeries(item.points) }))
  return {
    series: results.map(({ originalCount: _original, sampled: _sampled, ...item }) => item),
    originalCount: Math.max(0, ...results.map((item) => item.originalCount)),
    sampled: results.some((item) => item.sampled),
  }
}

export type ChartRow = Record<string, string | number | null>

export function mergeRows(series: Series[]): ChartRow[] {
  const rows = new Map<string, ChartRow>()
  series.forEach((item, index) => {
    for (const point of item.points) {
      const key = String(point.x)
      const row = rows.get(key) ?? { x: point.x }
      row[`series-${index}`] = point.y
      rows.set(key, row)
    }
  })
  return [...rows.values()].sort((left, right) => {
    const a = left.x
    const b = right.x
    if (typeof a === "number" && typeof b === "number") {
      return a - b
    }
    return String(a).localeCompare(String(b))
  })
}

export function chartNeedsSampling(chart: ChartSpec): boolean {
  return chart.series.some((series) => series.points.length > MAX_CHART_POINTS)
}

export function chartSampleInfo(chart: ChartSpec): {
  series: Series[]
  originalCount: number
  sampled: boolean
} {
  return sampledSeries(chart.series)
}
