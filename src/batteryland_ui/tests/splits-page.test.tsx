import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { endpoints } from "@/api/endpoints"
import type { DataSource, Split, SplitPreviewResponse } from "@/api/models"
import i18n from "@/i18n"
import { SplitsPage } from "@/pages/splits-page"
import { renderPage } from "./render"

const dataSource: DataSource = {
  id: "source-1",
  name: "BatteryLife",
  root_alias: "battery_life",
  group_prefix: "",
  revision: 7,
  battery_count: 3,
  availability: "available",
  created_at: "2026-10-24T00:00:00Z",
}

const split: Split = {
  id: "split-1",
  name: "Logical subset",
  source_id: dataSource.id,
  revision: 1,
  head_version: 1,
  version: 1,
  counts: { train: 2, val: 0, test: 1 },
  created_at: "2026-10-24T00:00:00Z",
}

const selection = {
  source_id: dataSource.id,
  source_revision: dataSource.revision,
  battery_ids: ["battery-a", "battery-b", "battery-c"],
  battery_files: {
    "battery-a": { file_name: "cell-a.pkl", relative_key: "cell-a.pkl" },
    "battery-b": { file_name: "cell-b.pkl", relative_key: "cell-b.pkl" },
    "battery-c": { file_name: "cell-c.pkl", relative_key: "cell-c.pkl" },
  },
  include_all_source: false,
}

function page<T>(items: T[] = []) {
  return { items, total: items.length, page: 1, page_size: 200 }
}

function setPendingSelection(value = selection) {
  sessionStorage.setItem("batteryland.pending-split-selection", JSON.stringify(value))
}

beforeEach(async () => {
  sessionStorage.clear()
  await i18n.changeLanguage("zh-CN")
  vi.spyOn(endpoints.sources, "list").mockResolvedValue(page([dataSource]))
  vi.spyOn(endpoints.splits, "list").mockResolvedValue(page([]))
})

describe("dataset split workflow", () => {
  it("previews and saves a random partition created from bulk dataset selection", async () => {
    setPendingSelection()
    const preview = vi.spyOn(endpoints.splits, "preview").mockResolvedValue({
      source_revision: dataSource.revision,
      counts: { all: 3, train: 2, val: 1, test: 0 },
    } satisfies SplitPreviewResponse)
    const create = vi.spyOn(endpoints.splits, "create").mockResolvedValue(split)
    const user = userEvent.setup()
    renderPage(<SplitsPage />, "/splits?create=1")

    await user.click(await screen.findByRole("button", { name: "继续" }))
    await user.click(screen.getByRole("button", { name: "预览划分" }))
    expect(await screen.findByText("训练集")).toBeInTheDocument()
    await waitFor(() =>
      expect(preview).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "BatteryLife",
          source_id: dataSource.id,
          battery_ids: selection.battery_ids,
          include_all_source: false,
          expected_source_revision: dataSource.revision,
          method: "random",
          ratios: { train: 0.7, val: 0.15, test: 0.15 },
          seed: 42,
        }),
      ),
    )

    await user.click(screen.getByRole("button", { name: "保存划分" }))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "BatteryLife",
          battery_ids: selection.battery_ids,
          method: "random",
        }),
      ),
    )
    expect(sessionStorage.getItem("batteryland.pending-split-selection")).toBeNull()
  })

  it("offers a link back to the fixed dataset catalog when scope is missing", async () => {
    renderPage(<SplitsPage />, "/splits?create=1")

    expect(await screen.findByText("请先选择数据范围")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "数据集目录" })).toHaveAttribute("href", "/resources")
    expect(screen.getByRole("button", { name: "继续" })).toBeDisabled()
  })

  it("exposes existing reusable split records without an extra template step", async () => {
    vi.spyOn(endpoints.splits, "list").mockResolvedValue(page([split]))
    renderPage(<SplitsPage />)

    expect(await screen.findByRole("heading", { name: "数据划分" })).toBeInTheDocument()
    expect(await screen.findByText("Logical subset")).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
