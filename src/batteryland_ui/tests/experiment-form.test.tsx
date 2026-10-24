import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, it, vi } from "vitest"

import { endpoints } from "@/api/endpoints"
import type { Experiment, Template } from "@/api/models"
import { parseJsonObject } from "@/components/json-editor"
import { TrainingConfigEditor } from "@/components/training-config-editor"
import i18n from "@/i18n"
import { ExperimentFormDialog } from "@/pages/experiment-form-dialog"

const page = { items: [], total: 0, page: 1, page_size: 200 }

it("does not display invented defaults for an incomplete imported configuration", () => {
  render(<TrainingConfigEditor value={parseJsonObject("{}")} onChange={vi.fn()} rawLabel="Raw" />)
  expect(screen.getByLabelText("随机种子")).toHaveValue(null)
  expect(screen.getByLabelText("运行设备")).not.toHaveTextContent("CPU")
})

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
  vi.spyOn(endpoints.splits, "list").mockResolvedValue(page)
  vi.spyOn(endpoints.templates, "list").mockResolvedValue(page)
  vi.spyOn(endpoints.components, "checkpoints").mockResolvedValue(page)
  vi.spyOn(endpoints.components, "list").mockResolvedValue([])
})

it("creates a normal experiment without requiring a visible JSON editor", async () => {
  const create = vi.spyOn(endpoints.experiments, "create").mockResolvedValue({} as Experiment)
  const user = userEvent.setup()
  render(<ExperimentFormDialog open onOpenChange={vi.fn()} editing={null} onSaved={vi.fn()} />)
  expect(screen.queryByRole("textbox", { name: "原生配置" })).not.toBeInTheDocument()
  await user.type(screen.getByLabelText("名称"), "Simple experiment")
  await user.click(screen.getByRole("button", { name: "创建草稿" }))
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "Simple experiment",
      native_config: expect.objectContaining({ mate: expect.objectContaining({ device: "cpu" }) }),
    }),
  )
})

it("changes a numeric setting while preserving custom values and references", async () => {
  const native = {
    mate: { seed: 42, device: "cpu", epochs: 12, marker: "@keep" },
    task: { type: "MyTask", custom: { retain: true } },
    model: { type: "Custom", params: { expression: "@model_width" } },
  }
  const experiment = {
    id: "example",
    name: "Existing",
    kind: "train",
    revision: 3,
    state: "draft",
    created_at: "2026-10-24T00:00:00Z",
    collection: { status: "unavailable", error: null },
    bindings: {},
    native_config: native,
  } as Experiment
  vi.spyOn(endpoints.experiments, "get").mockResolvedValue(experiment)
  const update = vi.spyOn(endpoints.experiments, "update").mockResolvedValue(experiment)
  const user = userEvent.setup()
  render(
    <ExperimentFormDialog open onOpenChange={vi.fn()} editing={experiment} onSaved={vi.fn()} />,
  )
  const seed = await screen.findByLabelText("随机种子")
  await user.clear(seed)
  await user.type(seed, "17")
  await user.click(screen.getByRole("button", { name: "保存草稿" }))
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith(
      "example",
      expect.objectContaining({
        expected_revision: 3,
        native_config: { ...native, mate: { ...native.mate, seed: 17 } },
      }),
    ),
  )
})

it("keeps the latest template selection and user-entered name when responses race", async () => {
  const user = userEvent.setup()
  const first = {
    id: "first",
    name: "First",
    revision: 1,
    head_version: 1,
    version: 1,
    created_at: "2026-10-24T00:00:00Z",
    native_config: { mate: { device: "cpu", seed: 3 }, task: { type: "MyTask" } },
  }
  const second = {
    ...first,
    id: "second",
    name: "Second",
    native_config: { ...first.native_config, mate: { device: "cpu", seed: 88 } },
  }
  vi.mocked(endpoints.templates.list).mockResolvedValue({ ...page, items: [first, second] })
  let finishFirst!: (template: Template) => void
  vi.spyOn(endpoints.templates, "get").mockImplementation((id) =>
    id === "first"
      ? new Promise<Template>((resolve) => {
          finishFirst = resolve
        })
      : Promise.resolve(second),
  )
  render(<ExperimentFormDialog open onOpenChange={vi.fn()} editing={null} onSaved={vi.fn()} />)
  await user.click(screen.getByLabelText("从模板填充"))
  await user.click(await screen.findByRole("option", { name: /First/ }))
  expect(screen.getByRole("button", { name: "创建草稿" })).toBeDisabled()
  await user.type(screen.getByLabelText("名称"), "User name")
  await user.click(screen.getByLabelText("从模板填充"))
  await user.click(await screen.findByRole("option", { name: /Second/ }))
  await waitFor(() => expect(screen.getByLabelText("随机种子")).toHaveValue(88))
  expect(endpoints.templates.get).toHaveBeenCalledWith(
    "second",
    second.version,
    expect.any(AbortSignal),
  )
  finishFirst(first)
  await waitFor(() => expect(screen.getByLabelText("随机种子")).toHaveValue(88))
  expect(screen.getByLabelText("名称")).toHaveValue("User name")
})
