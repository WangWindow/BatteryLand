import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ElementType, ReactNode } from "react"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { api } from "../src/api/client"
import SingleModelPage from "../src/pages/single-model"

vi.mock("@primer/react", () => {
  const FormControl = Object.assign(
    ({ children, className }: { children: ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
    { Label: ({ children }: { children: ReactNode }) => <span>{children}</span> },
  )
  const Select = Object.assign(
    (props: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} />,
    { Option: (props: React.OptionHTMLAttributes<HTMLOptionElement>) => <option {...props} /> },
  )
  return {
    Button: ({
      as: Component = "button",
      children,
      leadingVisual: _leadingVisual,
      ...props
    }: { as?: ElementType; children?: ReactNode; leadingVisual?: unknown } & Record<string, unknown>) => (
      <Component {...props}>{children}</Component>
    ),
    Dialog: Object.assign(({ children }: { children: ReactNode }) => <div>{children}</div>, {
      Body: ({ children }: { children: ReactNode }) => <div>{children}</div>,
      Footer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    }),
    FormControl,
    Select,
    Spinner: () => <span>加载中</span>,
  }
})

vi.mock("../src/api/client", () => ({
  api: {
    experiments: vi.fn(),
    experiment: vi.fn(),
    results: vi.fn(),
    sohCurves: vi.fn(),
  },
}))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <SingleModelPage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe("single model page", () => {
  beforeEach(() => {
    vi.mocked(api.experiments).mockResolvedValue({
      items: [
        {
          id: "experiment-a",
          name: "CPMLP 实验",
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
        },
      ],
      total: 1,
      page: 1,
      page_size: 100,
    })
    vi.mocked(api.experiment).mockResolvedValue({
      id: "experiment-a",
      experiment_id: "experiment-a",
      name: "CPMLP 实验",
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
      config_sha256: "config",
      split_sha256: "split",
      config: {
        model: { type: "CPMLP" },
        task: { type: "BatteryLifeRun" },
        datafactory: { params: { dataset: "MATR" } },
      },
      split: {},
      split_counts: { train: 102, val: 34, test: 2 },
      receipt: {},
      provider_commit: "test",
      created_at: "2026-11-01T00:00:00Z",
    })
    vi.mocked(api.results).mockResolvedValue({
      available: true,
      version: 1,
      best_epoch: 12,
      reason: null,
      metrics: [],
      sources: [],
      warnings: [],
      predictions: [
        {
          battery_id: "unresolved:experiment-a:cell-1.pkl",
          file_name: "cell-1.pkl",
          prediction: 110,
          target: 100,
          granularity: "mean_by_battery",
        },
        {
          battery_id: "unresolved:experiment-a:cell-2.pkl",
          file_name: "cell-2.pkl",
          prediction: 160,
          target: 200,
          granularity: "mean_by_battery",
        },
      ],
    })
    vi.mocked(api.sohCurves).mockResolvedValue({
      source_name: "MATR",
      items: ["cell-1", "cell-2"].map((cell, index) => ({
        battery_id: cell,
        file_name: `${cell}.pkl`,
        cell_id: cell,
        points: [
          { cycle: 1, soh: 1 },
          { cycle: 80 + index * 100, soh: 0.86 },
        ],
      })),
      warnings: [],
    })
  })

  it("loads completed experiments as the only source and shows real analysis", async () => {
    renderPage()

    expect(
      screen.queryByText("这里只读取“实验”模块已完成的真实训练结果，不支持单独导入预测文件。"),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("导入预测结果")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "加载示例数据" })).not.toBeInTheDocument()

    expect(await screen.findByText("真实实验结果")).toBeInTheDocument()
    expect(screen.getByText("CPMLP")).toBeInTheDocument()
    expect(screen.getByText("MATR")).toBeInTheDocument()
    expect(screen.getByText("102 / 34 / 2")).toBeInTheDocument()
    expect(screen.getByText("25.00")).toBeInTheDocument()
    expect(screen.getByText("50.00%")).toBeInTheDocument()
    expect(screen.getByText("测试电池真实 SOH 退化曲线与 EOL 预测")).toBeInTheDocument()
    expect(await screen.findByText("EOL 100–200 次 · 2 块电池")).toBeInTheDocument()
    expect(screen.getByLabelText("cell-1 曲线与 EOL 标记")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "隐藏 cell-1" }))
    expect(screen.queryByLabelText("cell-1 曲线与 EOL 标记")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "显示 cell-1" }))
    expect(screen.getByLabelText("cell-1 曲线与 EOL 标记")).toBeInTheDocument()
    expect(api.sohCurves).toHaveBeenCalledWith({
      dataset_name: "MATR",
      file_names: ["cell-1.pkl", "cell-2.pkl"],
      max_points: 300,
    })

    fireEvent.change(screen.getByLabelText("筛选"), { target: { value: "failed" } })
    await waitFor(() => expect(screen.getByText("当前显示 1 / 2 条")).toBeInTheDocument())
    expect(screen.getByRole("rowheader", { name: "cell-2.pkl" })).toBeInTheDocument()
  })

  it("directs users to create an experiment when none has completed", async () => {
    vi.mocked(api.experiments).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 })
    renderPage()

    expect(await screen.findByText("暂无已完成实验")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "新建实验" })).toHaveAttribute("href", "/experiments/new")
    expect(api.experiment).not.toHaveBeenCalled()
    expect(api.results).not.toHaveBeenCalled()
  })
})
