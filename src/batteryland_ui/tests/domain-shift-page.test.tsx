import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { api } from "../src/api/client"
import type { DomainShiftAnalysis } from "../src/api/types"
import DomainShiftPage from "../src/pages/domain-shift"

vi.mock("@primer/react/next", () => ({ useTheme: () => ({ colorMode: "day" }) }))
vi.mock("echarts/core", () => ({
  use: vi.fn(),
  init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }),
}))

vi.mock("@primer/react", () => ({
  FormControl: Object.assign(({ children }: { children: ReactNode }) => <div>{children}</div>, {
    Label: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  }),
  Select: Object.assign((props: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} />, {
    Option: (props: React.OptionHTMLAttributes<HTMLOptionElement>) => <option {...props} />,
  }),
  Button: ({ children, disabled, onClick }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}))
vi.mock("../src/components/common", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  Empty: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Loading: () => <span>加载中</span>,
  ErrorNotice: ({ error }: { error?: Error }) => (error ? <p>{error.message}</p> : null),
}))
vi.mock("../src/components/chart-view", () => ({ ChartView: () => <div /> }))
vi.mock("../src/api/client", () => ({
  api: {
    sources: vi.fn(),
    domainShiftModels: vi.fn(),
    domainShiftArchitectures: vi.fn(),
    domainShiftCacheStatus: vi.fn(),
    startDomainShiftBuild: vi.fn(),
    domainShiftJob: vi.fn(),
    domainShiftAnalysis: vi.fn(),
    domainShiftDistribution: vi.fn(),
  },
}))

const parameters = { seq_len: 2, early_cycle_threshold: 6, charge_discharge_length: 4 }
const checkpointLocation = {
  run_id: "experiment_20261106_170954_818407_4155310",
  relative_key:
    "experiments/experiment/runs/experiment_20261106_170954_818407_4155310/checkpoint/pretrained.pth",
  relative_path:
    "var/experiments/experiment/runs/experiment_20261106_170954_818407_4155310/checkpoint/pretrained.pth",
}
const physicalResult: DomainShiftAnalysis = {
  representation: { feature_space: "physical", model: null },
  summary: { source_count: 1, target_count: 1, feature_count: 2, sample_count: 3, sample_unit: "循环" },
  datasets: [],
  features: [{ name: "charge_V_mean", group: "电压统计" }],
  dropped_features: [],
  pca: { points: [], explained_variance: [], loadings: {} },
  shift: [
    {
      feature: "charge_V_mean",
      group: "电压统计",
      source_mean: 3.5,
      target_mean: 3.6,
      source_std: 0.1,
      target_std: 0.2,
      wd_norm: 0.5,
      smd: 0.4,
      n_source: 2,
      n_target: 2,
    },
  ],
  pairwise: [],
}
const modelResult: DomainShiftAnalysis = {
  ...physicalResult,
  representation: {
    feature_space: "model",
    model: { experiment_id: "experiment", checkpoint_id: "weight", layer: "embedding" },
    model_type: "TestEncoder",
    checkpoint_name: "pretrained.pth",
    weight_source: "checkpoint",
  },
  summary: { ...physicalResult.summary, sample_unit: "电池" },
  features: [{ name: "embedding_0000", group: "模型表示" }],
  shift: [],
  model_analysis: {
    method: "tsne",
    input_dimensions: 128,
    pooled_dimensions: 64,
    pca_dimensions: 2,
    perplexity: 1,
    explained_variance: [],
    reference_threshold: 0.1,
    warnings: [],
    points: [
      { dataset: "source", dataset_name: "源数据", domain: "源域", cell_uid: "source/a", x: 0, y: 0 },
      { dataset: "source", dataset_name: "源数据", domain: "源域", cell_uid: "source/b", x: 1, y: 0 },
      { dataset: "target", dataset_name: "目标数据", domain: "目标域", cell_uid: "target/c", x: 0.1, y: 0.1 },
    ],
    similarities: [
      {
        target_id: "target",
        target_name: "目标数据",
        samples: 1,
        centroid_cosine_distance: 0.01,
        mean_nearest_source_distance: 0.02,
        outside_source_fraction: 0,
      },
    ],
    matches: [
      {
        target_id: "target",
        target_name: "目标数据",
        cell_uid: "target/c",
        nearest_source_id: "source",
        nearest_source_name: "源数据",
        nearest_source_cell_uid: "source/a",
        cosine_distance: 0.02,
        outside_source: false,
      },
    ],
  },
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <DomainShiftPage />
    </QueryClientProvider>,
  )
}

async function selectModelAndData() {
  await screen.findByRole("combobox", { name: "特征来源" })
  fireEvent.change(screen.getByRole("combobox", { name: "特征来源" }), { target: { value: "model" } })
  fireEvent.change(screen.getByRole("combobox", { name: "模型来源" }), { target: { value: "direct" } })
  await screen.findByRole("option", { name: "TestEncoder" })
  fireEvent.change(screen.getByRole("combobox", { name: "模型" }), { target: { value: "TestEncoder" } })
  fireEvent.click(screen.getAllByRole("checkbox", { name: /源数据/ })[0])
  fireEvent.click(screen.getAllByRole("checkbox", { name: /目标数据/ })[1])
  return screen.findByRole("button", { name: "提取剩余 2 个文件的特征" })
}

describe("domain shift direct model selection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.sources).mockResolvedValue({
      items: [
        { id: "source", name: "源数据", available_battery_count: 1 },
        { id: "target", name: "目标数据", available_battery_count: 1 },
      ],
      total: 2,
      page: 1,
      page_size: 20,
    } as Awaited<ReturnType<typeof api.sources>>)
    vi.mocked(api.domainShiftModels).mockResolvedValue([])
    vi.mocked(api.domainShiftArchitectures).mockResolvedValue([
      {
        model_type: "TestEncoder",
        parameters,
        required_parameters: Object.keys(parameters),
        supported: true,
        reason: null,
      },
      {
        model_type: "Unsupported",
        parameters: {},
        required_parameters: [],
        supported: false,
        reason: "不支持 embedding",
      },
    ])
    vi.mocked(api.domainShiftCacheStatus).mockResolvedValue({ items: [], missing_files: 2 })
    const job = { id: "job", state: "completed" as const, done: 2, total: 2, built: 2, failed: [] }
    vi.mocked(api.startDomainShiftBuild).mockResolvedValue(job)
    vi.mocked(api.domainShiftJob).mockResolvedValue(job)
  })

  it("extracts with a selected architecture and seed when there are no experiments", async () => {
    renderPage()
    await selectModelAndData()
    expect(screen.getByRole("combobox", { name: "模型来源" })).toHaveValue("direct")
    expect(screen.getByRole("option", { name: /Unsupported/ })).toBeDisabled()
    expect(api.domainShiftModels).toHaveBeenCalled()
    expect(screen.getByRole("textbox", { name: "模型参数" })).toHaveValue(JSON.stringify(parameters, null, 2))
    fireEvent.change(screen.getByRole("spinbutton", { name: "初始化种子" }), { target: { value: "43" } })
    fireEvent.click(await screen.findByRole("button", { name: "提取剩余 2 个文件的特征" }))
    await waitFor(() =>
      expect(api.startDomainShiftBuild).toHaveBeenCalledWith(["source", "target"], 1, 4, {
        feature_space: "model",
        model: { model_type: "TestEncoder", parameters, initialization_seed: 43, layer: "embedding" },
        batch_size: 32,
        device: "cpu",
      }),
    )
  })

  it("blocks extraction while model parameters or the initialization seed are invalid", async () => {
    renderPage()
    await selectModelAndData()
    fireEvent.change(screen.getByRole("textbox", { name: "模型参数" }), { target: { value: "{" } })
    expect(screen.getByRole("button", { name: "开始分析" })).toBeDisabled()
    expect(screen.getByText("请输入有效的 JSON 对象。")).toBeInTheDocument()
    fireEvent.change(screen.getByRole("textbox", { name: "模型参数" }), {
      target: { value: JSON.stringify(parameters) },
    })
    fireEvent.change(screen.getByRole("spinbutton", { name: "初始化种子" }), { target: { value: "-1" } })
    expect(screen.getByRole("button", { name: "开始分析" })).toBeDisabled()
    expect(api.startDomainShiftBuild).not.toHaveBeenCalled()
  })

  it("names missing required parameters and blocks extraction when a required value is null", async () => {
    renderPage()
    await selectModelAndData()
    const calls = vi.mocked(api.domainShiftCacheStatus).mock.calls.length
    fireEvent.change(screen.getByRole("textbox", { name: "模型参数" }), {
      target: { value: JSON.stringify({ ...parameters, early_cycle_threshold: null }) },
    })
    expect(screen.getByText("请填写必需模型参数：early_cycle_threshold")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "开始分析" })).toBeDisabled()
    expect(api.domainShiftCacheStatus).toHaveBeenCalledTimes(calls)
    expect(api.startDomainShiftBuild).not.toHaveBeenCalled()
  })

  it("defaults to completed experiment weights and renders a dedicated model analysis", async () => {
    vi.mocked(api.domainShiftModels).mockResolvedValue([
      {
        experiment_id: "experiment",
        name: "源域预训练",
        model_type: "TestEncoder",
        checkpoints: [
          {
            id: "broken",
            name: "adapter.pth",
            supported: false,
            reason: "非完整权重",
            ...checkpointLocation,
          },
          { id: "weight", name: "pretrained.pth", supported: true, reason: null, ...checkpointLocation },
        ],
      },
    ])
    vi.mocked(api.domainShiftCacheStatus).mockResolvedValue({ items: [], missing_files: 0 })
    vi.mocked(api.domainShiftAnalysis).mockResolvedValue(modelResult)
    renderPage()
    fireEvent.change(await screen.findByRole("combobox", { name: "特征来源" }), {
      target: { value: "model" },
    })
    expect(screen.getByRole("combobox", { name: "模型来源" })).toHaveValue("experiment")
    expect(screen.getByRole("option", { name: "电池级（窗口 embedding 取均值）" })).toBeInTheDocument()
    await screen.findByRole("option", { name: /源域预训练/ })
    fireEvent.change(screen.getByRole("combobox", { name: "已完成实验" }), {
      target: { value: "experiment" },
    })
    expect(screen.getByRole("combobox", { name: "权重文件" })).toHaveValue("weight")
    expect(screen.getByRole("option", { name: /adapter.pth/ })).toBeEnabled()
    expect(screen.getByText(checkpointLocation.relative_path)).toBeInTheDocument()
    expect(screen.getByText(`运行编号：${checkpointLocation.run_id}`)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole("checkbox", { name: /源数据/ })[0])
    fireEvent.click(screen.getAllByRole("checkbox", { name: /目标数据/ })[1])
    await waitFor(() => expect(screen.getByRole("button", { name: "开始分析" })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: "开始分析" }))
    await screen.findByRole("heading", { name: "t-SNE 联合降维图" })
    expect(screen.getByRole("img", { name: "源域与目标域模型 embedding 联合降维图" })).toBeInTheDocument()
    expect(screen.getByText("target/c")).toBeInTheDocument()
    expect(screen.queryByRole("tab", { name: "单特征分布" })).not.toBeInTheDocument()
    expect(screen.queryByRole("tab", { name: "特征差异" })).not.toBeInTheDocument()
    expect(api.domainShiftDistribution).not.toHaveBeenCalled()
    expect(api.domainShiftAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "cell",
        projection_method: "tsne",
        pool_dim: 64,
        model: { experiment_id: "experiment", checkpoint_id: "weight", layer: "embedding" },
      }),
    )
    fireEvent.change(screen.getByRole("textbox", { name: "查找目标电池" }), { target: { value: "missing" } })
    expect(screen.getByText("没有符合筛选条件的目标电池。")).toBeInTheDocument()
  })

  it("shows the found checkpoint and its reason when every weight is unavailable", async () => {
    vi.mocked(api.domainShiftModels).mockResolvedValue([
      {
        experiment_id: "experiment",
        name: "XJTU 实验",
        model_type: "cpmlp",
        checkpoints: [
          {
            id: "weight",
            name: "model.safetensors",
            supported: false,
            reason: "未找到模型源码或曲线加载器",
            ...checkpointLocation,
          },
        ],
      },
    ])
    renderPage()
    fireEvent.change(await screen.findByRole("combobox", { name: "特征来源" }), {
      target: { value: "model" },
    })
    await screen.findByRole("option", { name: /XJTU 实验 · cpmlp · experiment/ })
    fireEvent.change(screen.getByRole("combobox", { name: "已完成实验" }), {
      target: { value: "experiment" },
    })
    expect(screen.getByRole("combobox", { name: "权重文件" })).toHaveValue("weight")
    expect(screen.getByText(checkpointLocation.relative_path)).toBeInTheDocument()
    expect(screen.getByText("未找到模型源码或曲线加载器")).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole("checkbox", { name: /源数据/ })[0])
    fireEvent.click(screen.getAllByRole("checkbox", { name: /目标数据/ })[1])
    expect(screen.getByRole("button", { name: "开始分析" })).toBeDisabled()
    expect(api.domainShiftCacheStatus).not.toHaveBeenCalled()
  })

  it("keeps physical feature field names and removes the persistent feature description", async () => {
    const names = [
      "charge_voltage_median",
      "discharge_voltage_iqr",
      "charge_dqdv_peak_fraction_per_V",
      "discharge_dvdq_peak_capacity_fraction",
    ]
    vi.mocked(api.domainShiftCacheStatus).mockResolvedValue({ items: [], missing_files: 0 })
    vi.mocked(api.domainShiftAnalysis).mockResolvedValue({
      ...physicalResult,
      features: names.map((name) => ({ name, group: "物理特征" })),
      shift: names.map((feature) => ({ ...physicalResult.shift[0], feature })),
    })
    vi.mocked(api.domainShiftDistribution).mockResolvedValue({
      feature: names[0],
      series: [],
      statistics: [],
      box_statistics: [],
      trend_series: [],
    })
    renderPage()
    await screen.findByRole("combobox", { name: "特征来源" })
    fireEvent.click(screen.getAllByRole("checkbox", { name: /源数据/ })[0])
    fireEvent.click(screen.getAllByRole("checkbox", { name: /目标数据/ })[1])
    await waitFor(() => expect(screen.getByRole("button", { name: "开始分析" })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: "开始分析" }))
    fireEvent.click(await screen.findByRole("tab", { name: "单特征分布" }))
    for (const name of names) {
      expect(screen.getByRole("option", { name: `${name} · 物理特征` })).toHaveValue(name)
    }
    expect(screen.queryByText(/统计特征含中位数、IQR/)).not.toBeInTheDocument()
    const select = screen.getByRole("combobox", { name: "单特征" })
    fireEvent.change(select, { target: { value: names[3] } })
    await waitFor(() =>
      expect(api.domainShiftDistribution).toHaveBeenCalledWith(
        expect.objectContaining({ feature: names[3], group_by: "dataset", bins: 40, clip: true }),
      ),
    )
  })

  it("removes the cycle trend module from physical single feature distributions", async () => {
    vi.mocked(api.domainShiftCacheStatus).mockResolvedValue({ items: [], missing_files: 0 })
    vi.mocked(api.domainShiftAnalysis).mockResolvedValue(physicalResult)
    vi.mocked(api.domainShiftDistribution).mockResolvedValue({
      feature: "charge_V_mean",
      series: [],
      statistics: [],
      box_statistics: [],
      trend_series: [{ key: "source", label: "源数据", points: [{ x: 1, y: 3.5 }] }],
    })
    renderPage()
    await screen.findByRole("combobox", { name: "特征来源" })
    fireEvent.click(screen.getAllByRole("checkbox", { name: /源数据/ })[0])
    fireEvent.click(screen.getAllByRole("checkbox", { name: /目标数据/ })[1])
    await waitFor(() => expect(screen.getByRole("button", { name: "开始分析" })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: "开始分析" }))
    fireEvent.click(await screen.findByRole("tab", { name: "单特征分布" }))
    await waitFor(() => expect(api.domainShiftDistribution).toHaveBeenCalled())
    expect(screen.queryByText("该特征随循环次数的变化")).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "t-SNE 联合降维图" })).not.toBeInTheDocument()
  })
})
