import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import SingleModelPage from "../src/pages/single-model"

describe("single model page", () => {
  it("updates chart and score when changing stage and handles missing results", () => {
    render(<SingleModelPage />)
    expect(screen.getByText("15%-ACC：83.3%（5/6）")).toBeInTheDocument()
    expect(screen.getByText("演示数据")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("阶段"), { target: { value: "validation" } })
    expect(screen.getByText("15%-ACC：100.0%（4/4）")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("实验"), { target: { value: "demo-b" } })
    expect(screen.getByText("暂无验证集预测结果")).toBeInTheDocument()
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("阶段"), { target: { value: "test" } })
    expect(screen.getByText("15%-ACC：80.0%（4/5）")).toBeInTheDocument()
    expect(screen.getByText("未提供")).toBeInTheDocument()
    expect(screen.getByText("暂无")).toBeInTheDocument()
  })
})
