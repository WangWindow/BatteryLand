import { type APIRequestContext, expect, type Page, test } from "@playwright/test"

const CONFIG = `mate:\n  seed: 42\n  device: auto\n  duration: 0.3\ntask:\n  type: MyTask\ndatafactory:\n  type: BatteryLandBatteryLifeDatasetFactory\n  params:\n    dataset: pending-split\n`

async function openNavigation(page: Page, group: string, item: string) {
  const groupButton = page.getByRole("button", { name: group, exact: true })
  if (await groupButton.isVisible()) {
    const expanded = await groupButton.getAttribute("aria-expanded")
    if (expanded !== "true") await groupButton.click()
  }
  await page.getByRole("link", { name: item, exact: true }).click()
}

async function experimentId(request: APIRequestContext, name: string) {
  let id = ""
  await expect
    .poll(async () => {
      const response = await request.get(
        `/api/v1/validated-experiments?q=${encodeURIComponent(name)}&page_size=200`,
      )
      const body = (await response.json()) as {
        data: { items: Array<{ id: string; name: string }> }
      }
      id = body.data.items.find((item) => item.name === name)?.id ?? ""
      return id.length > 0
    })
    .toBe(true)
  return id
}

async function waitForState(request: APIRequestContext, id: string, expected: string) {
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/v1/validated-experiments/${id}`)
        const body = (await response.json()) as { data: { state: string } }
        return body.data.state
      },
      { timeout: 90_000 },
    )
    .toBe(expected)
}

async function importAndValidate(page: Page, name: string, editSeed?: string) {
  await page.locator("#experiment-name").fill(name)
  await page.locator('input[type="file"]').setInputFiles({
    name: "experiment.yaml",
    mimeType: "application/yaml",
    buffer: Buffer.from(CONFIG),
  })
  await page.locator("#experiment-split").click()
  await page.getByRole("option", { name: /E2E logical subset/ }).click()
  await expect(page.getByRole("status")).toHaveCount(0)
  if (editSeed) {
    await page.getByRole("button", { name: /mate.seed/ }).click()
    await page.locator("#config-value").fill(editSeed)
  }
  await page.getByRole("button", { name: "校验配置" }).click()
  await expect(page.getByText("校验通过，可以保存实验").first()).toBeVisible({ timeout: 20_000 })
  await page.getByRole("button", { name: "保存实验" }).click()
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
}

test.describe.configure({ mode: "serial" })

test("fixed datasets flow through splitting, configuration, training, results and comparisons", async ({
  page,
  request,
}) => {
  test.setTimeout(240_000)

  await page.goto("/resources")
  await expect(page.getByRole("heading", { name: "数据集目录" })).toBeVisible()
  const dataset = await page.getByRole("button", { name: /demo.*6 个电池文件/ }).first()
  await dataset.click()
  await page.getByRole("button", { name: "选择整个数据源" }).click()
  await expect(page.getByText("整个数据源，共 6 个文件")).toBeVisible()
  await page.getByRole("button", { name: "创建划分" }).click()

  await expect(page.getByRole("heading", { name: "数据划分" })).toBeVisible()
  await page.getByRole("textbox").first().fill("E2E logical subset")
  await page.getByRole("button", { name: "继续" }).click()
  await page.getByRole("button", { name: "预览划分" }).click()
  await expect(page.getByText("训练集")).toBeVisible()
  await page.getByRole("button", { name: "保存划分" }).click()
  await expect(page.getByText("E2E logical subset").first()).toBeVisible()

  await openNavigation(page, "执行", "实验")
  await page.getByRole("link", { name: "新建实验" }).click()
  await expect(page.getByRole("heading", { name: "新建实验" })).toBeVisible()
  await importAndValidate(page, "E2E first")

  await page.getByRole("button", { name: "提交训练" }).click()
  const firstId = await experimentId(request, "E2E first")
  await waitForState(request, firstId, "succeeded")
  await expect(page.getByText("已完成").first()).toBeVisible({ timeout: 30_000 })

  await page.getByRole("tab", { name: "日志" }).click()
  await page.getByLabel("日志流").click()
  await page.getByRole("option", { name: "控制台" }).click()
  await expect(
    page.getByText(/BatteryLand controlled training (started|finished)/).first(),
  ).toBeVisible({ timeout: 20_000 })

  await page.getByRole("tab", { name: "结果" }).click()
  await expect(page.getByText("mape", { exact: true }).first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText("cell-a.pkl").first()).toBeVisible()
  await page.getByRole("tab", { name: "产物" }).click()
  await expect(page.getByText("best_result.json").first()).toBeVisible()

  await page.getByRole("button", { name: "使用此配置新建实验" }).click()
  await expect(page.getByRole("heading", { name: "新建实验" })).toBeVisible()
  await importAndValidate(page, "E2E second", "43")
  await page.getByRole("button", { name: "提交训练" }).click()
  const secondId = await experimentId(request, "E2E second")
  expect(secondId).not.toBe(firstId)
  await waitForState(request, secondId, "succeeded")

  await openNavigation(page, "分析", "结果分析")
  await expect(page.getByRole("heading", { name: "结果分析" })).toBeVisible()
  await page.getByRole("checkbox", { name: "选择 E2E first", exact: true }).check()
  await page.getByRole("checkbox", { name: "选择 E2E second", exact: true }).check()
  await expect(page.getByText(/指标行（\d+）/)).toBeVisible({ timeout: 20_000 })
  await page.getByRole("combobox", { name: "指标" }).click()
  await page.getByRole("option", { name: "mape", exact: true }).click()
  await page.getByRole("button", { name: "绘制图表" }).click()
  await expect(page.locator(".recharts-surface").first()).toBeVisible({ timeout: 20_000 })

  await page.getByRole("tab", { name: "数据集差异" }).click()
  await page.locator("#set-ref-set-1").click()
  await page.getByRole("option", { name: "demo", exact: true }).click()
  await page.locator("#set-ref-set-2").click()
  await page.getByRole("option", { name: /E2E logical subset/ }).click()
  await page.getByRole("button", { name: "绘制图表" }).click()
  await expect(page.locator(".recharts-surface").first()).toBeVisible({ timeout: 20_000 })

  const first = await request.get(`/api/v1/validated-experiments/${firstId}`)
  const firstBody = (await first.json()) as { data: { config: Record<string, unknown> } }
  expect(firstBody.data.config).toMatchObject({
    mate: { device: "auto", seed: 42 },
    datafactory: { type: "BatteryLandBatteryLifeDatasetFactory" },
  })
})

test("narrow viewport keeps the workbench usable and keyboard access starts at the skip link", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/resources")
  await expect(page.getByRole("heading", { name: "数据集目录" })).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  expect(overflow).toBe(false)
  await page.keyboard.press("Tab")
  await expect(page.getByRole("link", { name: "跳到主内容" })).toBeFocused()
})
