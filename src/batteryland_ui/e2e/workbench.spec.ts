import { expect, test } from "@playwright/test"

const FILES = ["cell-a.pkl", "cell-b.pkl", "cell-c.pkl", "cell-d.pkl", "cell-e.pkl", "cell-f.pkl"]

const CONFIG = {
  mate: { seed: 42, device: "cpu", experiment: "browser-e2e", duration: 0.6 },
  task: { type: "MyTask" },
}

const FIRST_RESULT = {
  epoch: 3,
  test: { mape: 0.12, ABC: 8 },
  units: { mape: "ratio" },
  test_predictions: [
    { file_name: "cell-a.pkl", prediction: 88, target: 90 },
    { file_name: "cell-b.pkl", prediction: 79, target: 82 },
  ],
  history: [
    { train: { loss: 0.9 }, validation: { mape: 0.3 } },
    { train: { loss: 0.6 }, validation: { mape: 0.2 } },
    { train: { loss: 0.4 }, validation: { mape: 0.15 } },
  ],
}

const SECOND_RESULT = {
  epoch: 4,
  test: { mae: 3, ABC: null },
  units: { mae: "cycles" },
  test_predictions: [
    { file_name: "cell-c.pkl", prediction: 70, target: 72 },
    { file_name: "cell-d.pkl", prediction: 65, target: null },
  ],
  history: [
    { train: { loss: 0.8 }, validation: { mape: 0.4 } },
    { train: { loss: 0.5 }, validation: { mape: 0.25 } },
  ],
}

async function pollExperiment(request: import("@playwright/test").APIRequestContext, name: string) {
  let identity = ""
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `/api/v1/experiments?q=${encodeURIComponent(name)}&page_size=200`,
        )
        const body = (await response.json()) as {
          data: { items: Array<{ id: string; name: string }> }
        }
        const item = body.data.items.find((value) => value.name === name)
        identity = item?.id ?? ""
        return identity.length > 0
      },
      { timeout: 30_000 },
    )
    .toBe(true)
  return identity
}

async function waitForState(
  request: import("@playwright/test").APIRequestContext,
  identity: string,
  states: string[],
) {
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/v1/experiments/${identity}`)
        const body = (await response.json()) as { data: { state: string } }
        return states.includes(body.data.state)
      },
      { timeout: 60_000 },
    )
    .toBe(true)
}

test.describe.configure({ mode: "serial" })

test("browser workbench drives resources, configuration, execution, logs, results and six charts", async ({
  page,
  request,
}) => {
  test.setTimeout(240_000)
  const visualizerRequests: string[] = []
  page.on("request", (event) => {
    if (event.url().includes("/src/visualizer/")) {
      visualizerRequests.push(event.url())
    }
  })

  await page.goto("/resources")
  await expect(page.getByRole("heading", { name: "数据来源与电池" })).toBeVisible()

  // Register a source allowed by the test backend and import a manifest through the UI.
  await page.getByRole("button", { name: "登记来源" }).click()
  let dialog = page.getByRole("dialog")
  await dialog.locator("#source-name").fill("E2E source")
  await dialog.locator("#source-alias").click()
  await page.getByRole("option", { name: "demo", exact: true }).click()
  await dialog.getByRole("button", { name: "登记", exact: true }).click()
  await page.getByText("管理来源", { exact: true }).click()
  await expect(page.getByRole("cell", { name: "E2E source" })).toBeVisible()

  await page.getByRole("button", { name: "导入清单" }).click()
  dialog = page.getByRole("dialog")
  await dialog.getByLabel("目标来源").click()
  await page.getByRole("option", { name: /E2E source/ }).click()
  await dialog.locator("#manifest-file").setInputFiles({
    name: "manifest.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ batteries: FILES.map((file_name) => ({ file_name })) }),
      "utf8",
    ),
  })
  await expect(dialog.getByText(/6 条电池/)).toBeVisible()
  await dialog.getByRole("button", { name: "开始导入" }).click()
  await expect(dialog.getByText(/新增 6/)).toBeVisible()
  await dialog.getByRole("button", { name: "关闭" }).last().click()
  await expect(page.getByRole("cell", { name: "cell-a.pkl" })).toBeVisible()
  await page.screenshot({ path: "/tmp/batteryland-resources-004.png", fullPage: true })

  // Create a manual split using the real battery picker.
  await page.getByRole("link", { name: "数据划分" }).click()
  await expect(page.getByRole("heading", { name: "数据划分" })).toBeVisible()
  await page.getByRole("button", { name: "新建划分" }).first().click()
  dialog = page.getByRole("dialog")
  await dialog.locator("#split-name").fill("E2E split")
  for (const file of FILES) {
    await dialog.getByRole("checkbox", { name: file }).click()
  }
  await dialog.getByRole("button", { name: "创建划分" }).click()
  await expect(page.getByRole("cell", { name: "E2E split" })).toBeVisible()

  // Save a template through the JSON editor.
  await page.getByRole("link", { name: "实验模板" }).click()
  await page.getByRole("button", { name: "新建模板" }).first().click()
  dialog = page.getByRole("dialog")
  await dialog.locator("#template-name").fill("E2E template")
  await dialog.getByText("高级配置", { exact: true }).click()
  await dialog.getByLabel("原生配置").fill(JSON.stringify(CONFIG, null, 2))
  await dialog.getByRole("button", { name: "创建模板" }).click()
  await expect(page.getByRole("cell", { name: "E2E template" })).toBeVisible()

  // Create and submit the first experiment with template + split bindings.
  await page.getByRole("link", { name: "实验", exact: true }).click()
  await page.getByRole("button", { name: "新建实验" }).first().click()
  dialog = page.getByRole("dialog")
  await dialog.locator("#experiment-name").fill("E2E first")
  await page.screenshot({ path: "/tmp/batteryland-form-004.png" })
  await dialog.getByLabel("从模板填充").click()
  await page.getByRole("option", { name: /E2E template/ }).click()
  await expect(dialog.getByLabel("随机种子")).toHaveValue("42", { timeout: 10_000 })
  await expect(dialog.getByLabel("原生配置")).toHaveCount(0)
  await dialog.getByLabel("数据划分").click()
  await page.getByRole("option", { name: /E2E split/ }).click()
  await dialog.getByRole("button", { name: "创建草稿" }).click()

  let row = page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: "E2E first", exact: true }) })
  await expect(row).toBeVisible()
  await row.getByRole("button", { name: "实验操作" }).click()
  await page.getByRole("menuitem", { name: "提交到队列" }).click()
  const firstId = await pollExperiment(request, "E2E first")
  await waitForState(request, firstId, ["succeeded"])

  // Observe real logs and collect deterministic results through the test-only fixture endpoint.
  await page.getByRole("link", { name: "E2E first", exact: true }).click()
  await expect(page.getByRole("heading", { name: "E2E first", exact: true })).toBeVisible()
  await page.getByRole("tab", { name: "日志" }).click()
  await page.getByRole("button", { name: "控制台" }).click()
  await expect(page.getByText(/browser e2e (started|finished)/)).toBeVisible({ timeout: 20_000 })
  await request.post(`/__test__/results/${firstId}`, { data: FIRST_RESULT })
  await page.reload()
  await page.getByRole("tab", { name: "结果" }).click()
  await expect(page.getByText("mape").first()).toBeVisible()
  await expect(page.getByText("0.12 ratio").first()).toBeVisible()
  await page.getByRole("tab", { name: "产物" }).click()
  await expect(page.getByRole("cell", { name: "best_result.json" }).first()).toBeVisible()

  // Copy the terminal experiment, submit the independent draft, and collect a second result.
  await page.getByRole("link", { name: "实验", exact: true }).click()
  row = page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: "E2E first", exact: true }) })
  await row.getByRole("button", { name: "实验操作" }).click()
  await page.getByRole("menuitem", { name: "复制为草稿" }).click()
  await expect(page.getByRole("link", { name: "E2E first copy", exact: true })).toBeVisible()
  const copyId = await pollExperiment(request, "E2E first copy")
  row = page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: "E2E first copy", exact: true }) })
  await row.getByRole("button", { name: "实验操作" }).click()
  await page.getByRole("menuitem", { name: "提交到队列" }).click()
  await waitForState(request, copyId, ["succeeded"])
  await request.post(`/__test__/results/${copyId}`, { data: SECOND_RESULT })

  // Compare data and exercise all six declarative chart types in the browser.
  await page.getByRole("link", { name: "结果比较" }).click()
  await expect(page.getByRole("heading", { name: "结果比较" })).toBeVisible()
  await page.getByRole("checkbox", { name: "选择 E2E first", exact: true }).check()
  await page.getByRole("checkbox", { name: "选择 E2E first copy", exact: true }).check()
  await page.getByText("数据明细", { exact: true }).click()
  await expect(page.getByText(/指标行（\d+）/)).toBeVisible({ timeout: 20_000 })
  await page.getByText("数据明细", { exact: true }).click()
  expect(visualizerRequests).toHaveLength(0)

  await page.locator("#chart-metric").click()
  await page.getByRole("option", { name: "mape", exact: true }).click()
  await page.getByRole("button", { name: "生成图表" }).click()
  await expect(page.locator(".recharts-surface").first()).toBeVisible({ timeout: 20_000 })
  expect(visualizerRequests.length).toBeGreaterThan(0)

  await page.locator("#chart-type").click()
  await page.getByRole("option", { name: "轮次曲线" }).click()
  await page.locator("#chart-stage").click()
  await page.getByRole("option", { name: "验证" }).click()
  await page.locator("#chart-metric").click()
  await page.getByRole("option", { name: "mape", exact: true }).click()
  await page.getByRole("button", { name: "生成图表" }).click()
  await expect(page.getByText(/validation mape/).first()).toBeVisible({ timeout: 20_000 })

  await page.locator("#chart-type").click()
  await page.getByRole("option", { name: "预测散点图" }).click()
  await page.getByRole("button", { name: "生成图表" }).click()
  await expect(page.locator(".recharts-scatter").first()).toBeVisible({ timeout: 20_000 })

  await page.locator("#chart-type").click()
  await page.getByRole("option", { name: "集合数量" }).click()
  await page.locator("#set-split-set-1").click()
  await page.getByRole("option", { name: /E2E split/ }).click()
  await page.getByRole("button", { name: "生成图表" }).click()
  await expect(page.locator(".recharts-bar-rectangle").first()).toBeVisible({ timeout: 20_000 })

  await page.getByRole("button", { name: "添加集合" }).click()
  await page.locator("#set-split-set-2").click()
  await page.getByRole("option", { name: /E2E split/ }).click()
  await page.getByRole("checkbox", { name: "集合 2 的 test 分区" }).check()
  await page.locator("#chart-type").click()
  await page.getByRole("option", { name: "集合重叠" }).click()
  await page.getByRole("button", { name: "生成图表" }).click()
  await expect(page.locator(".recharts-bar-rectangle").first()).toBeVisible({ timeout: 20_000 })

  await page.locator("#chart-type").click()
  await page.getByRole("option", { name: "分类分布" }).click()
  await page.getByRole("button", { name: "生成图表" }).click()
  await expect(page.locator(".recharts-bar-rectangle").first()).toBeVisible({ timeout: 20_000 })

  // Language switching updates visible labels and the document language.
  await page.getByRole("combobox", { name: "语言" }).click()
  await page.getByRole("option", { name: "English" }).click()
  await expect(page.getByRole("heading", { name: "Result comparison" })).toBeVisible()
  await expect(page.locator("html")).toHaveAttribute("lang", "en")
  await page.getByRole("combobox", { name: "Language" }).click()
  await page.getByRole("option", { name: "简体中文" }).click()
  await expect(page.getByRole("heading", { name: "结果比较" })).toBeVisible()
})

test("browser can stop a real running execution and observe the terminal state", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000)
  await page.goto("/experiments")
  await page.getByRole("button", { name: "新建实验" }).first().click()
  const dialog = page.getByRole("dialog")
  await dialog.locator("#experiment-name").fill("E2E stop")
  await dialog.getByLabel("从模板填充").click()
  await page.getByRole("option", { name: /E2E template/ }).click()
  const longRunning = {
    ...CONFIG,
    mate: { ...CONFIG.mate, duration: 30 },
  }
  await dialog.getByText("高级配置", { exact: true }).click()
  await dialog.getByLabel("原生配置").fill(JSON.stringify(longRunning, null, 2))
  await dialog.getByRole("button", { name: "创建草稿" }).click()
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: "E2E stop", exact: true }) })
  await expect(row).toBeVisible()
  await row.getByRole("button", { name: "实验操作" }).click()
  await page.getByRole("menuitem", { name: "提交到队列" }).click()
  const identity = await pollExperiment(request, "E2E stop")
  await waitForState(request, identity, ["starting", "running"])
  await page.getByRole("link", { name: "E2E stop", exact: true }).click()
  const stopButton = page.getByRole("button", { name: "请求停止" })
  await expect(stopButton).toBeVisible({ timeout: 20_000 })
  await stopButton.click()
  await waitForState(request, identity, ["stopped"])
  await expect(page.getByText("已停止").first()).toBeVisible({ timeout: 20_000 })
})

test("lazy chart module failure shows a localized recoverable error", async ({ page }) => {
  test.setTimeout(120_000)
  await page.route("**/src/visualizer/**", (route) => route.abort())
  await page.goto("/compare")
  await page.getByRole("checkbox", { name: "选择 E2E first", exact: true }).check()
  await page.locator("#chart-metric").click()
  await page.getByRole("option", { name: "mape", exact: true }).click()
  await page.getByRole("button", { name: "生成图表" }).click()
  await expect(page.getByText("模块加载失败")).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole("button", { name: "重新加载" })).toBeVisible()
})

test("narrow viewport has no horizontal overflow and keyboard reaches the skip link", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/resources")
  await expect(page.getByRole("heading", { name: "数据来源与电池" })).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  expect(overflow).toBe(false)
  await page.keyboard.press("Tab")
  await expect(page.getByRole("link", { name: "跳到主内容" })).toBeFocused()
})
