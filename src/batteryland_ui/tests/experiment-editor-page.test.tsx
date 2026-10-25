import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, expect, it, vi } from "vitest"

import { endpoints } from "@/api/endpoints"
import type { Split, ValidatedExperiment } from "@/api/models"
import i18n from "@/i18n"
import { ExperimentEditorPage } from "@/pages/experiment-editor-page"

const split: Split = {
  id: "split-1",
  name: "Demo split",
  source_id: "source-1",
  revision: 1,
  head_version: 1,
  version: 1,
  counts: { train: 1, val: 0, test: 0 },
  created_at: "2026-10-24T00:00:00Z",
  method: "manual",
} as Split

const savedExperiment = {
  id: "experiment-1",
  experiment_id: "experiment-1",
  name: "E2E editor test",
  state: "draft",
} as ValidatedExperiment

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
  vi.spyOn(endpoints.splits, "list").mockResolvedValue({
    items: [split],
    total: 1,
    page: 1,
    page_size: 200,
  })
  vi.spyOn(endpoints.splits, "exportDocument").mockResolvedValue({
    dataset: "demo",
    train: ["a.pkl"],
    val: [],
    test: [],
  })
  vi.spyOn(endpoints.components, "list").mockResolvedValue([])
  vi.spyOn(endpoints.scheduler, "resources").mockResolvedValue([])
})

it("imports YAML, edits a property, validates with the API and saves a draft", async () => {
  const validate = vi.spyOn(endpoints.experiments, "validate").mockResolvedValue({
    valid: true,
    config: {},
    split: {},
    receipt: { token: "signed" },
    execution_supported: true,
    limitations: [],
  })
  const create = vi.spyOn(endpoints.experiments, "create").mockResolvedValue(savedExperiment)
  const user = userEvent.setup()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { container } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/experiments/new"]}>
        <Routes>
          <Route path="/experiments/new" element={<ExperimentEditorPage />} />
          <Route path="/experiments/:experimentId" element={<div data-testid="saved-route" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

  await user.type(screen.getByLabelText("实验名称"), "E2E editor test")
  const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
  expect(fileInput).not.toBeNull()
  await user.upload(
    fileInput as HTMLInputElement,
    new File(
      [
        "mate:\n  device: auto\n  seed: 42\ndatafactory:\n  type: BatteryLife\n  params:\n    dataset: old\ntask:\n  type: MyTask\ncustom:\n  retain: true\n",
      ],
      "experiment.yaml",
      { type: "application/yaml" },
    ),
  )

  await user.click(screen.getByLabelText("数据划分"))
  await user.click(await screen.findByRole("option", { name: /Demo split/ }))
  await waitFor(() =>
    expect(endpoints.splits.exportDocument).toHaveBeenCalledWith(
      "split-1",
      undefined,
      expect.any(AbortSignal),
    ),
  )
  await user.click(screen.getByRole("button", { name: /mate.seed/ }))
  const value = await screen.findByLabelText("值")
  await user.clear(value)
  await user.type(value, "17")

  await user.click(screen.getByRole("button", { name: "校验配置" }))
  await waitFor(() =>
    expect(validate).toHaveBeenCalledWith(
      expect.objectContaining({
        config_text: expect.stringContaining("seed: 17"),
        split_text: expect.stringContaining('"dataset": "demo"'),
      }),
    ),
  )
  await user.click(await screen.findByRole("button", { name: "保存实验" }))

  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "E2E editor test",
        receipt: { token: "signed" },
        config_text: expect.stringContaining("retain: true"),
      }),
    ),
  )
  expect(await screen.findByTestId("saved-route")).toBeInTheDocument()
})
