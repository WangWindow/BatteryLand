import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { CommonBattery, ComparedRun } from "../src/features/multi-model/data"
import { ErrorHeatmap } from "../src/features/multi-model/error-heatmap"

const runs: ComparedRun[] = [
  { id: "a", name: "CPMLP 实验", model: "CPMLP", color: "#0969da", rows: [] },
  { id: "b", name: "LSTM 实验", model: "LSTM", color: "#cf222e", rows: [] },
]

const batteries: CommonBattery[] = [
  { key: "one", id: "one", fileName: "one.pkl", target: 100, predictions: { a: 102, b: 130 } },
  { key: "two", id: "two", fileName: "two.pkl", target: 200, predictions: { a: 170, b: 198 } },
]

describe("error heatmap", () => {
  it("renders the model-by-battery matrix and keeps detailed values collapsible", () => {
    render(<ErrorHeatmap runs={runs} batteries={batteries} />)

    expect(screen.getAllByText("CPMLP").length).toBeGreaterThan(0)
    expect(screen.getAllByText("LSTM").length).toBeGreaterThan(0)
    expect(screen.getByText("展开详细数据")).toBeInTheDocument()
    expect(screen.getAllByText("2.00%").length).toBeGreaterThan(0)

    fireEvent.change(screen.getByLabelText("电池排序"), { target: { value: "max-error" } })
    expect(screen.getByDisplayValue("按最大误差降序")).toBeInTheDocument()
  })
})
