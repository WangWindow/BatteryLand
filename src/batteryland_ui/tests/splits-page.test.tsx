import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

import i18n from "@/i18n"
import { SplitsPage } from "@/pages/splits-page"

function envelope(data: unknown) {
  return new Response(JSON.stringify({ code: 0, message: "ok", data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

function source(batteryCount = 2) {
  return {
    id: "source-1",
    name: "Demo source",
    root_alias: "demo",
    revision: 2,
    battery_count: batteryCount,
    availability: "available",
    created_at: "2026-10-24T00:00:00Z",
  }
}

function mockApi(batteryCount = 2, splitListItem?: unknown, splitDetail?: unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString()
    if (url.includes("/data-sources")) {
      return envelope({ items: [source(batteryCount)], total: 1, page: 1, page_size: 100 })
    }
    if (url.includes("/splits/preview") && init?.method === "POST") {
      return envelope({
        source_revision: 2,
        counts: { all: batteryCount, train: 1, val: 1, test: batteryCount - 2 },
      })
    }
    if (url.endsWith("/splits") && init?.method === "POST") {
      return envelope({ id: "split-1" })
    }
    if (url.includes("/splits/split-1/members")) {
      return envelope({ items: [], total: 0, page: 1, page_size: 200 })
    }
    if (url.includes("/splits/split-1")) {
      return envelope(splitDetail)
    }
    if (url.includes("/splits")) {
      return envelope({
        items: splitListItem ? [splitListItem] : [],
        total: splitListItem ? 1 : 0,
        page: 1,
        page_size: 50,
      })
    }
    if (url.includes("/batteries")) {
      const params = new URL(url, "http://batteryland.test").searchParams
      const page = Number(params.get("page") ?? 1)
      const pageSize = Number(params.get("page_size") ?? 100)
      const start = (page - 1) * pageSize
      const items = Array.from(
        { length: Math.max(0, Math.min(pageSize, batteryCount - start)) },
        (_, index) => {
          const number = start + index
          return {
            id: `battery-${number}`,
            source_id: "source-1",
            file_name: `battery-${number}.pkl`,
            relative_key: `battery-${number}.pkl`,
            parent_battery_id: null,
            metadata: {},
            availability: "available",
            created_at: "2026-10-24T00:00:00Z",
          }
        },
      )
      return envelope({ items, total: batteryCount, page, page_size: pageSize })
    }
    return envelope({})
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
})

describe("splits page dataset selection", () => {
  it("shows registered sources as selectable dataset cards with battery counts", async () => {
    mockApi()
    const user = userEvent.setup()
    render(<SplitsPage />)

    await user.click(screen.getByRole("button", { name: "新建划分" }))

    const sourceCard = await screen.findByRole("button", { name: /Demo source.*2 个电池/ })
    await user.click(sourceCard)
    expect(screen.getByRole("radio", { name: /使用整个来源/ })).toHaveAttribute(
      "aria-checked",
      "true",
    )
  })

  it("keeps a chosen battery when the user moves to another results page", async () => {
    mockApi(101)
    const user = userEvent.setup()
    render(<SplitsPage />)
    await user.click(screen.getByRole("button", { name: "新建划分" }))
    await user.click(await screen.findByRole("button", { name: /Demo source/ }))
    await user.click(screen.getByRole("radio", { name: /选择部分电池/ }))
    await user.click(await screen.findByRole("checkbox", { name: "battery-0.pkl" }))
    await user.click(screen.getByRole("button", { name: "下一页" }))

    expect(await screen.findByRole("checkbox", { name: "battery-100.pkl" })).toBeInTheDocument()
    expect(screen.getByText("已选 1")).toBeInTheDocument()
  })

  it("requires a current server preview before saving a whole-source split", async () => {
    const fetchMock = mockApi(4)
    const user = userEvent.setup()
    render(<SplitsPage />)
    await user.click(screen.getByRole("button", { name: "新建划分" }))
    await user.click(await screen.findByRole("button", { name: /Demo source/ }))
    await user.type(
      screen.getByLabelText("名称", { selector: "#split-name" }),
      "Demo logical dataset",
    )

    const save = screen.getByRole("button", { name: "创建划分" })
    expect(save).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "预览划分" }))
    expect(await screen.findByText("训练：1")).toBeInTheDocument()
    expect(save).toBeEnabled()
    fireEvent.change(screen.getByRole("slider", { name: "训练比例" }), {
      target: { value: "60" },
    })
    expect(screen.getByText("合计 100%")).toBeInTheDocument()
    expect(save).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "预览划分" }))
    expect(save).toBeEnabled()
    await user.click(save)

    const create = fetchMock.mock.calls.find(
      ([input, init]) => input.toString().endsWith("/splits") && init?.method === "POST",
    )
    expect(JSON.parse(String(create?.[1]?.body))).toMatchObject({
      include_all_source: true,
      expected_source_revision: 2,
      battery_ids: [],
      ratios: { train: 0.6, val: 0.2, test: 0.2 },
    })
  })

  it("loads the split version before opening its editor", async () => {
    const listItem = {
      id: "split-1",
      name: "Saved split",
      source_id: "source-1",
      revision: 1,
      head_version: 1,
      version: 1,
      counts: { train: 1, val: 0, test: 1 },
      created_at: "2026-10-24T00:00:00Z",
    }
    const detail = {
      ...listItem,
      payload: {
        dataset_name: "Saved split",
        source_id: "source-1",
        train: ["battery-0"],
        val: [],
        test: ["battery-1"],
        method: "manual",
        include_all_source: false,
        source_revision: 2,
        algorithm_version: "shuffle-v1",
        parameters: { ratios: null },
      },
    }
    mockApi(2, listItem, detail)
    const user = userEvent.setup()
    render(<SplitsPage />)
    await user.click(await screen.findByRole("button", { name: "编辑" }))

    expect(await screen.findByRole("dialog", { name: "编辑划分" })).toBeInTheDocument()
    expect(await screen.findByRole("checkbox", { name: "battery-0.pkl" })).toBeChecked()
    expect(screen.getByRole("radio", { name: /选择部分电池/ })).toHaveAttribute(
      "aria-checked",
      "true",
    )
  })

  it("guides the user to register battery files when every source is empty", async () => {
    mockApi(0)
    render(
      <MemoryRouter>
        <SplitsPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText(/还没有电池文件/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "前往数据来源" })).toHaveAttribute("href", "/resources")
    for (const button of screen.getAllByRole("button", { name: "新建划分" })) {
      expect(button).toBeDisabled()
    }
  })
})
