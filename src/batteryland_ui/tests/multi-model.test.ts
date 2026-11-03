import { describe, expect, it } from "vitest"
import {
  type ComparedRun,
  commonBatteries,
  comparisonCsv,
  comparisonSummaries,
  winnerCounts,
} from "../src/features/multi-model/data"

const runs: ComparedRun[] = [
  {
    id: "a",
    name: "模型A",
    model: "A",
    color: "blue",
    rows: [
      {
        id: "one",
        fileName: "one.pkl",
        prediction: 110,
        target: 100,
        lower: null,
        upper: null,
        granularity: "mean",
      },
      {
        id: "two",
        fileName: "two.pkl",
        prediction: 160,
        target: 200,
        lower: null,
        upper: null,
        granularity: "mean",
      },
      {
        id: "only-a",
        fileName: "only-a.pkl",
        prediction: 50,
        target: 50,
        lower: null,
        upper: null,
        granularity: "mean",
      },
    ],
  },
  {
    id: "b",
    name: "模型B",
    model: "B",
    color: "orange",
    rows: [
      {
        id: "one",
        fileName: "one.pkl",
        prediction: 95,
        target: 100,
        lower: null,
        upper: null,
        granularity: "mean",
      },
      {
        id: "two",
        fileName: "two.pkl",
        prediction: 210,
        target: 200,
        lower: null,
        upper: null,
        granularity: "mean",
      },
      {
        id: "bad-target",
        fileName: "bad-target.pkl",
        prediction: 40,
        target: 40,
        lower: null,
        upper: null,
        granularity: "mean",
      },
    ],
  },
]

describe("multi model comparison data", () => {
  it("uses only common batteries with matching real labels", () => {
    const batteries = commonBatteries(runs)
    expect(batteries.map((battery) => battery.fileName)).toEqual(["one.pkl", "two.pkl"])
    expect(batteries[0].predictions).toEqual({ a: 110, b: 95 })
  })

  it("recomputes metrics and per-battery winners on the common test set", () => {
    const batteries = commonBatteries(runs)
    const summaries = comparisonSummaries(runs, batteries)
    expect(summaries[0].summary.mae).toBe(25)
    expect(summaries[1].summary.mae).toBe(7.5)
    expect(winnerCounts(runs, batteries)).toEqual({ a: 0, b: 2 })
  })

  it("exports each model prediction and relative error", () => {
    const csv = comparisonCsv(runs, commonBatteries(runs))
    expect(csv).toContain("模型A_prediction")
    expect(csv).toContain("one.pkl,100,110,0.1,95,0.05")
  })
})
