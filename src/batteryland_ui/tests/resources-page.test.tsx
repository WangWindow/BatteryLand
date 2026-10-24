import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import i18n from "@/i18n"
import { ResourcesPage } from "@/pages/resources-page"

function envelope(data: unknown) {
  return new Response(JSON.stringify({ code: 0, message: "ok", data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

function source(id = "source-1") {
  return {
    id,
    name: "Demo source",
    root_alias: "demo",
    revision: 1,
    availability: "available",
    created_at: "2026-10-24T00:00:00Z",
  }
}

function mockApi(sources: unknown[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString()
    if (url.includes("/data-sources/options"))
      return envelope([{ root_alias: "demo", availability: "available" }])
    if (url.includes("/data-sources")) {
      return envelope({ items: sources, total: sources.length, page: 1, page_size: 100 })
    }
    if (url.includes("/batteries")) {
      return envelope({ items: [], total: 0, page: 1, page_size: 50 })
    }
    return envelope({})
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
})

describe("resources page", () => {
  it("shows an empty source state", async () => {
    mockApi([])
    render(<ResourcesPage />)
    await userEvent.click(screen.getByText("管理来源"))
    expect(await screen.findByText("尚无数据来源")).toBeInTheDocument()
  })

  it("validates required source fields before sending a request", async () => {
    const fetchMock = mockApi([])
    const user = userEvent.setup()
    render(<ResourcesPage />)
    await user.click(screen.getByRole("button", { name: "登记来源" }))
    await user.click(screen.getByRole("button", { name: "登记" }))
    expect(await screen.findByText("名称和来源别名都必须填写")).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/data-sources"))).toBe(
      true,
    )
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => String(input).endsWith("/data-sources") && init?.method === "POST",
      ),
    ).toBe(false)
  })

  it("reports invalid manifest JSON without a network import", async () => {
    const fetchMock = mockApi([source()])
    const user = userEvent.setup()
    render(<ResourcesPage />)
    await user.click(screen.getByText("管理来源"))
    await screen.findByRole("cell", { name: "Demo source" })
    await user.click(screen.getByRole("button", { name: "导入清单" }))
    const input = screen.getByLabelText("清单文件")
    await user.upload(input, new File(["not-json"], "manifest.json", { type: "application/json" }))
    expect(await screen.findByText(/JSON 无效/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([value]) => String(value).includes("/import"))).toBe(false)
  })

  it("renders the English catalog after switching language", async () => {
    mockApi([])
    await i18n.changeLanguage("en")
    render(<ResourcesPage />)
    await userEvent.click(screen.getByText("Manage sources"))
    expect(await screen.findByText("No data sources yet")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Data sources & batteries" })).toBeInTheDocument()
    await waitFor(() => expect(document.documentElement.lang).toBe("en"))
  })
})
