import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import type { ElementType, ReactNode } from "react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { api } from "../src/api/client"
import MultiModelPage from "../src/pages/multi-model"

vi.mock("@primer/react", () => ({
  Button: ({
    as: Component = "button",
    children,
    leadingVisual: _leadingVisual,
    ...props
  }: { as?: ElementType; children?: ReactNode; leadingVisual?: unknown } & Record<string, unknown>) => (
    <Component {...props}>{children}</Component>
  ),
  Spinner: () => <span>加载中</span>,
}))

vi.mock("../src/api/client", () => ({
  api: {
    experiments: vi.fn(),
    experiment: vi.fn(),
    results: vi.fn(),
    sohCurves: vi.fn(),
  },
}))

function experimentSummary(id: string, name: string) {
  return {
    id,
    name,
    state: "succeeded",
    revision: 1,
    created_at: "2026-11-01T00:00:00Z",
    kind: "training",
    requested_device: null,
    effective_device: null,
    actual_device: null,
    actual_gpu_uuid: null,
    execution: null,
    collection: {},
  }
}

function experimentDetail(id: string, model: string, splitSha = "same-split") {
  return {
    id,
    experiment_id: id,
    name: `${model} 实验`,
    state: "succeeded",
    revision: 1,
    version: 1,
    requested_device: null,
    resolved_device: null,
    actual_device: null,
    actual_gpu_uuid: null,
    config_text: "",
    split_text: "",
    split_id: "split-a",
    split_version: 1,
    config_sha256: `config-${id}`,
    split_sha256: splitSha,
    config: {
      model: { type: model },
      task: { type: "BatteryLifeRun" },
      datafactory: { params: { dataset: "MATR" } },
    },
    split: {},
    split_counts: { train: 8, val: 2, test: 2 },
    receipt: {},
    provider_commit: "test",
    created_at: "2026-11-01T00:00:00Z",
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <MultiModelPage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe("multi model page", () => {
  beforeEach(() => {
    vi.mocked(api.experiments).mockResolvedValue({
      items: [
        experimentSummary("a", "CPMLP 实验"),
        experimentSummary("b", "LSTM 实验"),
        experimentSummary("c", "其他划分实验"),
      ],
      total: 3,
      page: 1,
      page_size: 100,
    })
    vi.mocked(api.experiment).mockImplementation(async (id) => {
      if (id === "a") return experimentDetail(id, "CPMLP")
      if (id === "b") return experimentDetail(id, "LSTM")
      return experimentDetail(id, "CPMLP", "other-split")
    })
    vi.mocked(api.results).mockImplementation(async (id) => ({
      available: true,
      version: 1,
      best_epoch: id === "a" ? 10 : 12,
      reason: null,
      metrics: [],
      sources: [],
      warnings: [],
      predictions: [
        {
          battery_id: "one",
          file_name: "one.pkl",
          prediction: id === "a" ? 110 : 102,
          target: 100,
          granularity: "mean_by_battery",
        },
        {
          battery_id: "two",
          file_name: "two.pkl",
          prediction: id === "a" ? 160 : 195,
          target: 200,
          granularity: "mean_by_battery",
        },
      ],
    }))
    vi.mocked(api.sohCurves).mockResolvedValue({
      source_name: "MATR",
      items: ["one", "two"].map((cell, index) => ({
        battery_id: cell,
        file_name: `${cell}.pkl`,
        cell_id: cell,
        points: [
          { cycle: 1, soh: 1 },
          { cycle: 100 + index * 100, soh: 0.8 },
        ],
      })),
      warnings: [],
    })
  })

  it("automatically compares the first compatible pair on their common batteries", async () => {
    renderPage()

    expect(await screen.findByText("核心指标对比")).toBeInTheDocument()
    expect(screen.getByText("本次比较统一使用 2 块共同测试电池。")).toBeInTheDocument()
    expect(screen.getByText("逐电池预测误差热力图")).toBeInTheDocument()
    expect(screen.getByText("展开详细数据")).toBeInTheDocument()
    expect(screen.getByText("真实SOH退化曲线与多模型EOL预测")).toBeInTheDocument()
    expect(await screen.findByText(/LSTM · LSTM 实验 在共同测试集上的MAPE最低/)).toBeInTheDocument()
    expect(screen.getByText("不可比")).toBeInTheDocument()
    expect(api.sohCurves).toHaveBeenCalledWith({
      dataset_name: "MATR",
      file_names: ["one.pkl", "two.pkl"],
      max_points: 300,
    })
  })
})
