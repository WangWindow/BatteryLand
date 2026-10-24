import { describe, expect, it } from "vitest"

import type { Point } from "@/api/models"
import {
  MAX_CHART_POINTS,
  mergeRows,
  sampledSeries,
  sampleSeries,
  seriesColor,
} from "@/visualizer/transform"

function points(count: number, nullAt: number[] = []): Point[] {
  const missing = new Set(nullAt)
  return Array.from({ length: count }, (_, index) => ({
    x: index,
    y: missing.has(index) ? null : index,
  }))
}

describe("visualizer transform", () => {
  it("leaves small series untouched", () => {
    const input = points(10, [4])
    const result = sampleSeries(input)
    expect(result.sampled).toBe(false)
    expect(result.points).toEqual(input)
    expect(result.originalCount).toBe(10)
  })

  it("caps large series without interpolating and keeps missing breakpoints", () => {
    const input = points(5000, [100, 2000, 4998])
    const result = sampleSeries(input)
    expect(result.sampled).toBe(true)
    expect(result.points.length).toBeLessThanOrEqual(MAX_CHART_POINTS)
    expect(result.originalCount).toBe(5000)
    for (const index of [100, 2000, 4998]) {
      expect(result.points.some((point) => point.x === index && point.y === null)).toBe(true)
    }
    expect(
      result.points.every((point) => {
        const original = input[point.x as number]
        return original?.y === point.y
      }),
    ).toBe(true)
  })

  it("samples each chart series independently and reports the original maximum", () => {
    const result = sampledSeries([
      { id: "a", label: "A", points: points(100) },
      { id: "b", label: "B", points: points(1500) },
    ])
    expect(result.sampled).toBe(true)
    expect(result.originalCount).toBe(1500)
    expect(result.series[0].points).toHaveLength(100)
    expect(result.series[1].points.length).toBeLessThanOrEqual(MAX_CHART_POINTS)
  })

  it("keeps stable colors per series identity", () => {
    expect(seriesColor("experiment-a")).toBe(seriesColor("experiment-a"))
    expect(seriesColor("experiment-a")).toMatch(/^var\(--chart-[1-5]\)$/)
  })

  it("merges categorical and numeric rows without filling missing series values", () => {
    const rows = mergeRows([
      {
        id: "a",
        label: "A",
        points: [
          { x: "train", y: 1 },
          { x: "test", y: null },
        ],
      },
      { id: "b", label: "B", points: [{ x: "test", y: 2 }] },
    ])
    expect(rows).toEqual([
      { x: "test", "series-0": null, "series-1": 2 },
      { x: "train", "series-0": 1 },
    ])
  })
})
