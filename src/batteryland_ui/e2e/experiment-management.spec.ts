import { expect, test } from "@playwright/test"

const completedId = "55555555-5555-4555-8555-555555555555"
const activeId = "66666666-6666-4666-8666-666666666666"
const timestamp = "2026-10-26T03:00:00Z"

function summary(id: string, name: string, state: string) {
  return {
    id,
    name,
    kind: "train",
    state,
    revision: 1,
    created_at: timestamp,
    requested_device: "auto",
    effective_device: "cuda:0",
    actual_device: "cuda:0",
    actual_gpu_uuid: null,
    execution: null,
    collection: { status: "ready", error: null },
  }
}

function experiment(id: string) {
  return {
    ...summary(id, "预览测试实验", "succeeded"),
    version: 1,
    experiment_id: id,
    config_text: "mate:\n  device: auto\n",
    split_text: '{"dataset":"demo","train":[],"val":[],"test":[]}',
    split_id: null,
    split_version: null,
    config_sha256: "config-hash",
    split_sha256: "split-hash",
    config: {},
    split: {},
    split_counts: { train: 0, val: 0, test: 0 },
    receipt: { execution_supported: true },
    provider_commit: "provider-commit",
  }
}

function envelope(data: unknown, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify({ code: 0, message: "ok", data }),
  }
}

test("stops active experiments and deletes finished experiments from the row menu", async ({ page }) => {
  let items = [summary(completedId, "已完成实验", "succeeded"), summary(activeId, "运行中的实验", "running")]
  const deleted: string[] = []

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace("/api/v1", "")
    if (request.method() === "GET" && path === "/validated-experiments") {
      return route.fulfill(envelope({ items, total: items.length, page: 1, page_size: 50 }))
    }
    if (request.method() === "POST" && path === `/validated-experiments/${activeId}/stop`) {
      items = items.map((item) => (item.id === activeId ? { ...item, state: "cancelled" } : item))
      return route.fulfill(envelope({ ...experiment(activeId), state: "cancelled" }, 202))
    }
    if (request.method() === "DELETE" && path.startsWith("/validated-experiments/")) {
      const id = path.split("/").at(-1) ?? ""
      deleted.push(id)
      items = items.filter((item) => item.id !== id)
      return route.fulfill(envelope({ deleted: true }))
    }
    return route.fulfill(envelope({ detail: `Unmocked ${request.method()} ${path}` }, 404))
  })

  await page.goto("/experiments")
  await expect(page.getByText("已完成实验", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "实验操作：运行中的实验" }).click()
  const runningMenu = page.getByRole("menu")
  await expect(runningMenu.getByRole("menuitem", { name: "删除实验" })).toBeDisabled()
  await runningMenu.getByRole("menuitem", { name: "终止实验" }).click()
  await expect(page.getByRole("table").getByText("已取消", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "实验操作：已完成实验" }).click()
  await page.getByRole("menu").getByRole("menuitem", { name: "删除实验" }).click()
  const confirmation = page.getByRole("dialog", { name: "删除实验" })
  await expect(confirmation).toContainText("确定删除“已完成实验”吗")
  await confirmation.getByRole("button", { name: "删除实验" }).click()
  await expect(page.getByText("已完成实验", { exact: true })).toHaveCount(0)
  await expect(page.getByText("运行中的实验", { exact: true })).toBeVisible()
  expect(deleted).toEqual([completedId])

  await page.getByRole("button", { name: "实验操作：运行中的实验" }).click()
  await page.getByRole("menu").getByRole("menuitem", { name: "删除实验" }).click()
  await page.getByRole("dialog", { name: "删除实验" }).getByRole("button", { name: "删除实验" }).click()
  await expect(page.getByText("没有匹配的实验")).toBeVisible()
  expect(deleted).toEqual([completedId, activeId])
})

test("clicking a previewable artifact opens its read-only preview while download stays separate", async ({
  page,
}) => {
  const detail = experiment(completedId)
  let textPreviewRequests = 0
  let downloadRequests = 0

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace("/api/v1", "")
    if (request.method() === "GET" && path === `/validated-experiments/${completedId}`) {
      return route.fulfill(envelope(detail))
    }
    if (request.method() === "GET" && path === `/experiments/${completedId}/artifacts`) {
      return route.fulfill(
        envelope([
          {
            id: "artifact-result",
            experiment_id: completedId,
            component_id: null,
            origin: "execution",
            kind: "result",
            name: "best_result.json",
            sha256: "result-hash",
            size: 24,
            availability: "available",
            is_directory: false,
            created_at: timestamp,
          },
        ]),
      )
    }
    if (request.method() === "GET" && path === `/experiments/${completedId}/results`) {
      return route.fulfill(
        envelope({
          available: false,
          version: null,
          reason: "暂无可读取的结果。",
          metrics: [],
          predictions: [],
          warnings: [],
        }),
      )
    }
    if (request.method() === "GET" && path === `/experiments/${completedId}/logs`) {
      return route.fulfill(
        envelope({ stream: "console", text: "训练完成", next_cursor: "0", eof: true, state: "succeeded" }),
      )
    }
    if (request.method() === "GET" && path === "/artifacts/artifact-result/preview/text") {
      textPreviewRequests += 1
      return route.fulfill({ status: 200, contentType: "text/plain", body: '{"mape":0.1}' })
    }
    if (request.method() === "GET" && path === "/artifacts/artifact-result/download") {
      downloadRequests += 1
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"mape":0.1}' })
    }
    return route.fulfill(envelope({ detail: `Unmocked ${request.method()} ${path}` }, 404))
  })

  await page.goto(`/experiments/${completedId}`)
  const artifactCard = page.getByRole("button", { name: "预览 best_result.json" })
  await expect(artifactCard).toBeVisible()
  await artifactCard.click()
  await expect(page.getByRole("dialog", { name: "best_result.json" })).toBeVisible()
  await expect.poll(() => textPreviewRequests).toBe(1)
  await page.getByRole("dialog", { name: "best_result.json" }).getByRole("button", { name: "关闭" }).click()

  await expect(page.getByRole("button", { name: "下载 best_result.json" })).toBeVisible()
  await expect(page.getByRole("button", { name: "预览 best_result.json" })).toHaveCount(1)
  const artifactDownload = page.waitForEvent("download")
  await page.getByRole("button", { name: "下载 best_result.json" }).click()
  expect((await artifactDownload).suggestedFilename()).toBe("best_result.json")
  expect(downloadRequests).toBe(1)
})
