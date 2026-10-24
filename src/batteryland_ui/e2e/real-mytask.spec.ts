import { expect, test } from "@playwright/test"

const REAL_CONFIG = {
  mate: { seed: 42, device: "cpu", experiment: "real-browser-mytask" },
  task: { type: "MyTask" },
  hook: [{ type: "PrintStart" }, { type: "PrintEnd" }],
}

test.skip(
  process.env.E2E_REAL_TRAINING !== "1",
  "Requires deeplatform, CALCE-independent MyTask runtime and an integrated scheduler",
)

test("browser MyTask runs through the real provider and integrated scheduler", async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto("/experiments")
  await page.getByRole("button", { name: "新建实验" }).first().click()
  const dialog = page.getByRole("dialog")
  await dialog.locator("#experiment-name").fill("Real browser MyTask")
  await expect(dialog.getByLabel("原生配置")).toHaveCount(0)
  await dialog.getByText("高级配置", { exact: true }).click()
  await dialog.getByLabel("原生配置").fill(JSON.stringify(REAL_CONFIG, null, 2))
  await dialog.getByRole("button", { name: "创建草稿" }).click()

  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: "Real browser MyTask", exact: true }) })
  await expect(row).toBeVisible()
  await row.getByRole("button", { name: "实验操作" }).click()
  await page.getByRole("menuitem", { name: "提交到队列" }).click()

  await page.getByRole("link", { name: "Real browser MyTask", exact: true }).click()
  await expect(page.getByText("已完成").first()).toBeVisible({ timeout: 150_000 })
  await page.getByRole("tab", { name: "日志" }).click()
  await page.getByRole("button", { name: "控制台" }).click()
  await expect(page.getByText(/开始|Training started/).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/结束|Training finished/).first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole("tab", { name: "结果" }).click()
  await expect(page.getByText("结果尚不可用")).toBeVisible()
})
