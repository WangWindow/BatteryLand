import { describe, expect, it } from "vitest"
import { accuracy, demoExperiments, relativeError, validInterval } from "../src/features/single-model/data"

const row = { id: "test", prediction: 115, target: 100, lower: 90, upper: 120 }

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
  it("matches the demo score to its actual samples", () => {
    expect(accuracy(demoExperiments[0].stages.test)).toEqual({ passed: 5, total: 6, value: 5 / 6 })
  })
})
