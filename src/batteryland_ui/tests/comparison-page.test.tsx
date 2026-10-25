import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { endpoints } from "@/api/endpoints"
import type { Split } from "@/api/models"
import i18n from "@/i18n"
import { ComparisonPage } from "@/pages/comparison-page"
import { renderPage } from "./render"

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
  vi.spyOn(endpoints.experiments, "list").mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 50,
  })
  vi.spyOn(endpoints.sources, "list").mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 200,
  })
  vi.spyOn(endpoints.groups, "list").mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 200,
  })
})

afterEach(() => vi.restoreAllMocks())

it("builds a battery-set chart without requiring any experiment selection", async () => {
  const split = {
    id: "split-1",
    name: "Battery set",
    version: 2,
    head_version: 2,
    revision: 2,
    source_id: "source-1",
    method: "manual",
    counts: { train: 1, val: 0, test: 0 },
    created_at: "2026-10-24T00:00:00Z",
  } as Split
  vi.spyOn(endpoints.splits, "list").mockResolvedValue({
    items: [split],
    total: 1,
    page: 1,
    page_size: 200,
  })
  const charts = vi.spyOn(endpoints.analysis, "charts").mockResolvedValue({
    schema_version: 1,
    provider_id: "basic-charts/v1",
    charts: [],
    warnings: [],
  })
  const user = userEvent.setup()
  renderPage(<ComparisonPage />)
  await user.click(screen.getByRole("tab", { name: "数据集差异" }))
  const splitControl = document.getElementById("set-ref-set-1")
  expect(splitControl).not.toBeNull()
  if (!splitControl) throw new Error("Missing split selector")
  await user.click(splitControl)
  await user.click(await screen.findByRole("option", { name: /Battery set/ }))
  const secondSplitControl = document.getElementById("set-ref-set-2")
  expect(secondSplitControl).not.toBeNull()
  if (!secondSplitControl) throw new Error("Missing second split selector")
  await user.click(secondSplitControl)
  await user.click(await screen.findByRole("option", { name: /Battery set/ }))
  const generate = screen.getByRole("button", { name: "绘制图表" })
  expect(generate).toBeEnabled()
  await user.click(generate)
  await waitFor(() =>
    expect(charts).toHaveBeenCalledWith(
      expect.objectContaining({
        chart_type: "set_count_bar",
        sets: [
          expect.objectContaining({ split: { id: "split-1", version: 2 } }),
          expect.objectContaining({ split: { id: "split-1", version: 2 } }),
        ],
      }),
      expect.any(AbortSignal),
    ),
  )
  expect(charts.mock.calls[0]?.[0].experiment_ids).toBeUndefined()
})
