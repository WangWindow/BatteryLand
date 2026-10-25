import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { endpoints } from "@/api/endpoints"
import type { Battery, DataSource } from "@/api/models"
import i18n from "@/i18n"
import { ResourcesPage } from "@/pages/resources-page"
import { renderPage } from "./render"

const source: DataSource = {
  id: "source-1",
  name: "BatteryLife",
  root_alias: "battery_life",
  group_prefix: "",
  revision: 4,
  battery_count: 401,
  availability: "available",
  created_at: "2026-10-24T00:00:00Z",
}

function battery(index: number): Battery {
  return {
    id: `battery-${index}`,
    source_id: source.id,
    file_name: `cell-${String(index).padStart(3, "0")}.pkl`,
    relative_key: `cell-${String(index).padStart(3, "0")}.pkl`,
    parent_battery_id: null,
    metadata: {
      chemistry: index % 2 === 0 ? "NMC" : "LFP",
      material: "graphite",
      temperature_c: 25,
      nominal_capacity_ah: 2.5,
    },
    availability: "available",
    created_at: "2026-10-24T00:00:00Z",
  }
}

const allBatteries = Array.from({ length: source.battery_count }, (_, index) => battery(index))

beforeEach(async () => {
  sessionStorage.clear()
  await i18n.changeLanguage("zh-CN")
  vi.spyOn(endpoints.sources, "list").mockResolvedValue({
    items: [source],
    total: 1,
    page: 1,
    page_size: 200,
  })
  vi.spyOn(endpoints.batteries, "list").mockImplementation(async (params) => {
    const page = params.page ?? 1
    const pageSize = params.pageSize ?? 50
    return {
      items: allBatteries.slice((page - 1) * pageSize, page * pageSize),
      total: allBatteries.length,
      page,
      page_size: pageSize,
    }
  })
})

afterEach(() => vi.restoreAllMocks())

describe("fixed dataset catalog", () => {
  it("shows configured datasets and their known file counts without an import flow", async () => {
    const user = userEvent.setup()
    renderPage(<ResourcesPage />)

    const sourceButton = await screen.findByRole("button", { name: /BatteryLife/ })
    expect(sourceButton).toHaveTextContent("401 个电池文件")
    await user.click(sourceButton)
    await waitFor(() => expect(endpoints.batteries.list).toHaveBeenCalled())
    expect(await screen.findAllByText("cell-000.pkl")).not.toHaveLength(0)
    expect(screen.queryByRole("button", { name: /导入|登记/ })).not.toBeInTheDocument()
  })

  it("selects hundreds of filtered files across pages in one action", async () => {
    const user = userEvent.setup()
    const batteryList = vi.mocked(endpoints.batteries.list)
    renderPage(<ResourcesPage />)

    await user.click(await screen.findByRole("button", { name: /BatteryLife/ }))
    await screen.findAllByText("cell-000.pkl")
    await user.click(screen.getByRole("button", { name: "选择全部筛选结果" }))

    expect(await screen.findByText("已选择 401 个文件")).toBeInTheDocument()
    await waitFor(() => {
      expect(batteryList.mock.calls.filter(([params]) => params.pageSize === 200)).toHaveLength(3)
    })

    await user.click(screen.getByRole("button", { name: "创建划分" }))
    const selection = JSON.parse(
      sessionStorage.getItem("batteryland.pending-split-selection") ?? "null",
    ) as {
      battery_ids: string[]
      battery_files: Record<string, unknown>
      include_all_source: boolean
      source_revision: number
    }
    expect(selection).toMatchObject({ include_all_source: false, source_revision: 4 })
    expect(selection.battery_ids).toHaveLength(401)
    expect(Object.keys(selection.battery_files)).toHaveLength(401)
  })

  it("allows selecting an entire fixed dataset without loading every file row", async () => {
    const user = userEvent.setup()
    const batteryList = vi.mocked(endpoints.batteries.list)
    renderPage(<ResourcesPage />)

    await user.click(await screen.findByRole("button", { name: /BatteryLife/ }))
    await screen.findAllByText("cell-000.pkl")
    await user.click(screen.getByRole("button", { name: "选择整个数据源" }))
    expect(screen.getByText("整个数据源，共 401 个文件")).toBeInTheDocument()
    expect(batteryList.mock.calls.filter(([params]) => params.pageSize === 200)).toHaveLength(0)

    await user.click(screen.getByRole("button", { name: "创建划分" }))
    const selection = JSON.parse(
      sessionStorage.getItem("batteryland.pending-split-selection") ?? "null",
    ) as {
      battery_ids: string[]
      battery_files: Record<string, unknown>
      include_all_source: boolean
    }
    expect(selection).toEqual({
      source_id: "source-1",
      source_revision: 4,
      battery_ids: [],
      battery_files: {},
      include_all_source: true,
    })
  })
})
