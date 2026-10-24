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
      return envelope([
        {
          root_alias: "demo",
          display_name: "Demo folder",
          availability: "available",
          file_count: 1,
        },
      ])
    if (url.includes("/data-sources/source-1/files")) {
      return envelope({
        items: [
          {
            file_name: "a.pkl",
            relative_key: "nested/a.pkl",
            size_bytes: 1024,
            importable: true,
            reason: null,
          },
          {
            file_name: "b.pkl",
            relative_key: "nested/b.pkl",
            size_bytes: 2048,
            importable: false,
            reason: "duplicate_file_name",
          },
        ],
        total: 2,
        page: 1,
        page_size: 50,
      })
    }
    if (url.endsWith("/data-sources/source-1/import"))
      return envelope({ imported: 1, existing: 0, errors: [] })
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
    expect(await screen.findByText("尚无数据来源")).toBeInTheDocument()
  })

  it("shows the configured folder identity and candidate count", async () => {
    mockApi([source()])
    render(<ResourcesPage />)
    expect(await screen.findByText("Demo folder")).toBeInTheDocument()
    expect(screen.getByText("demo")).toBeInTheDocument()
    expect(screen.getByText("1 个可导入文件")).toBeInTheDocument()
  })

  it("validates required source fields before sending a request", async () => {
    const fetchMock = mockApi([])
    const user = userEvent.setup()
    render(<ResourcesPage />)
    await user.click(screen.getByRole("button", { name: "登记来源" }))
    await user.click(screen.getByRole("button", { name: "登记" }))
    expect(await screen.findByText("请填写数据集名称并选择服务端目录")).toBeInTheDocument()
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
    await screen.findAllByText("Demo source")
    await user.click(screen.getByText("高级导入"))
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
    expect(await screen.findByText("No data sources yet")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Data sources & batteries" })).toBeInTheDocument()
    await waitFor(() => expect(document.documentElement.lang).toBe("en"))
  })

  it("selects a folder file and submits only the selected battery", async () => {
    const fetchMock = mockApi([source()])
    const user = userEvent.setup()
    render(<ResourcesPage />)
    await user.click(await screen.findByRole("button", { name: "浏览目录" }))
    await user.click(await screen.findByRole("checkbox", { name: "选择 a.pkl" }))
    expect(screen.getByRole("checkbox", { name: "选择 b.pkl" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "导入所选 1 项" }))
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/data-sources/source-1/import") && init?.method === "POST",
        ),
      ).toBe(true),
    )
    const request = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/data-sources/source-1/import") && init?.method === "POST",
    )
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      batteries: [{ file_name: "a.pkl", relative_key: "nested/a.pkl" }],
    })
  })
})
