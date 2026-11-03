import { describe, expect, it } from "vitest"
import {
  accuracy,
  type Prediction,
  parsePredictionCsv,
  parsePredictionJson,
  predictionCsv,
  relativeError,
  summarize,
  validInterval,
} from "../src/features/single-model/data"

const row: Prediction = {
  id: "test",
  fileName: "test.pkl",
  granularity: "mean_by_battery",
  prediction: 115,
  target: 100,
  lower: 90,
  upper: 120,
}

describe("single model result calculations", () => {
  it("includes the 15% boundary but excludes larger errors", () => {
    expect(accuracy([row]).passed).toBe(1)
    expect(accuracy([{ ...row, prediction: 115.01 }]).passed).toBe(0)
    expect(accuracy([{ ...row, prediction: 85 }]).passed).toBe(1)
  })
  it("excludes missing and invalid targets", () => {
    expect(relativeError({ ...row, target: null })).toBeNull()
    expect(relativeError({ ...row, target: 0 })).toBeNull()
    expect(accuracy([row, { ...row, target: null }]).total).toBe(1)
    expect(accuracy([]).value).toBeNull()
  })
  it("rejects absent and reversed intervals", () => {
    expect(validInterval({ ...row, lower: null })).toBe(false)
    expect(validInterval({ ...row, lower: 130 })).toBe(false)
    expect(validInterval(row)).toBe(true)
  })
  it("calculates aggregate regression metrics from valid labelled rows", () => {
    const summary = summarize([
      { ...row, prediction: 110, target: 100 },
      { ...row, id: "two", prediction: 180, target: 200 },
      { ...row, id: "missing", prediction: null, target: 50 },
    ])
    expect(summary.predicted).toBe(2)
    expect(summary.labelled).toBe(2)
    expect(summary.mae).toBe(15)
    expect(summary.mse).toBe(250)
    expect(summary.rmse).toBeCloseTo(Math.sqrt(250))
    expect(summary.mape).toBeCloseTo(0.1)
    expect(summary.accuracy15.value).toBe(1)
  })
  it("exports a Chinese CSV without inventing missing intervals", () => {
    const csv = predictionCsv([{ ...row, lower: null, upper: null }])
    expect(csv).toContain("电池编号,文件名")
    expect(csv).toContain("test.pkl")
    expect(csv).not.toContain("undefined")
  })
  it("imports CSV predictions and validates required fields", () => {
    const imported = parsePredictionCsv(
      "battery_id,file_name,prediction,target,lower,upper,granularity\ncell-1,cell-1.pkl,110,100,90,120,mean_by_battery",
    )
    expect(imported.rows).toHaveLength(1)
    expect(imported.rows[0]).toMatchObject({ id: "cell-1", prediction: 110, target: 100 })
    expect(() => parsePredictionCsv("battery_id,target\ncell-1,100")).toThrow("prediction")
  })
  it("imports both standard JSON and native best_result.json", () => {
    const standard = parsePredictionJson(
      JSON.stringify({
        metadata: { model_name: "CPMLP", dataset_name: "MATR" },
        predictions: [{ battery_id: "cell-1", prediction: 100 }],
      }),
    )
    expect(standard.metadata.modelName).toBe("CPMLP")
    const native = parsePredictionJson(
      JSON.stringify({
        epoch: 9,
        test_predictions: [{ file_name: "cell-2.pkl", prediction: 200, target: 210 }],
      }),
    )
    expect(native.metadata.bestEpoch).toBe(9)
    expect(native.rows[0].id).toBe("cell-2.pkl")
  })
})
