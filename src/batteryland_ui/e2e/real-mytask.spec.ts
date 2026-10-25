import { type APIRequestContext, expect, type Page, test } from "@playwright/test"

const REAL_CONFIG = `mate:\n  seed: 42\n  device: cpu\ntask:\n  type: MyTask\n  hook:\n    - type: PrintStart\n    - type: PrintEnd\ndatafactory:\n  type: BatteryLandBatteryLifeDatasetFactory\n  params:\n    dataset: pending-split\n`

test.skip(
  process.env.E2E_REAL_TRAINING !== "1",
  "Requires deeplatform, BatteryLife_Processed and the isolated training interpreter",
)

async function experimentId(request: APIRequestContext, name: string): Promise<string> {
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

async function openNavigation(page: Page, group: string, item: string) {
  const groupButton = page.getByRole("button", { name: group, exact: true })
  if (await groupButton.isVisible()) {
    if ((await groupButton.getAttribute("aria-expanded")) !== "true") {
      await groupButton.click()
    }
  }
  await page.getByRole("link", { name: item, exact: true }).click()
}

async function createCalceSplit(page: Page) {
  await page.goto("/resources")
  await expect(page.getByRole("heading", { name: "数据集目录" })).toBeVisible()
  await page.getByRole("button", { name: /CALCE/ }).first().click()
  await page.getByRole("button", { name: "选择整个数据源" }).click()
  await page.getByRole("button", { name: "创建划分" }).click()

  await expect(page.getByRole("heading", { name: "数据划分" })).toBeVisible()
  await page.getByRole("textbox").first().fill("Real MyTask CALCE")
  await page.getByRole("button", { name: "继续" }).click()
  await page.getByRole("button", { name: "预览划分" }).click()
  await expect(page.getByText("训练集")).toBeVisible()
  await page.getByRole("button", { name: "保存划分" }).click()
  await expect(page.getByText("Real MyTask CALCE").first()).toBeVisible()
}

async function createAndSubmit(page: Page, request: APIRequestContext): Promise<string> {
  await page.getByRole("link", { name: "新建实验" }).click()
  await expect(page.getByRole("heading", { name: "新建实验" })).toBeVisible()
  await page.locator("#experiment-name").fill("Real browser MyTask")
  await page.locator('input[type="file"]').setInputFiles({
    name: "experiment.yaml",
    mimeType: "application/yaml",
    buffer: Buffer.from(REAL_CONFIG),
  })
  await page.locator("#experiment-split").click()
  await page.getByRole("option", { name: /Real MyTask CALCE/ }).click()
  await page.getByRole("button", { name: "校验配置" }).click()
  await expect(page.getByText("校验通过，可以保存实验").first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole("button", { name: "保存实验" }).click()
  await expect(page.getByRole("heading", { name: "Real browser MyTask" })).toBeVisible()
  const id = await experimentId(request, "Real browser MyTask")
  await page.getByRole("button", { name: "提交训练" }).click()
  return id
}

test("browser MyTask uses the saved split and isolated training interpreter", async ({
  page,
  request,
}) => {
  test.setTimeout(240_000)
  await createCalceSplit(page)
  await openNavigation(page, "执行", "实验")
  const id = await createAndSubmit(page, request)

  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/v1/validated-experiments/${id}`)
        const body = (await response.json()) as { data: { state: string } }
        return body.data.state
      },
      { timeout: 180_000 },
    )
    .toBe("succeeded")
  await expect(page.getByText("已完成").first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole("tab", { name: "日志" }).click()
  await page.getByLabel("日志流").click()
  await page.getByRole("option", { name: "控制台日志" }).click()
  await expect(page.getByText(/开始|Training started/).first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/结束|Training finished/).first()).toBeVisible({ timeout: 30_000 })

  const results = await request.get(`/api/v1/experiments/${id}/results`)
  expect((await results.json()).data.available).toBe(false)
  await page.getByRole("tab", { name: "结果" }).click()
  await expect(page.getByText("尚无可用结果")).toBeVisible()
})
