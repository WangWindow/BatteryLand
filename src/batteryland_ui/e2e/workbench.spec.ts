import { expect, test } from "@playwright/test"

const sourceId = "11111111-1111-4111-8111-111111111111"
const splitId = "22222222-2222-4222-8222-222222222222"
const experimentId = "33333333-3333-4333-8333-333333333333"
const problematicSplitId = "66666666-6666-4666-8666-666666666666"
const now = "2026-10-25T10:00:00Z"
const source = {
  id: sourceId,
  name: "CALCE",
  root_alias: "battery_life",
  group_prefix: "CALCE",
  revision: 1,
  battery_count: 10,
  available_battery_count: 10,
  availability: "available",
  created_at: now,
}
const batteries = Array.from({ length: 10 }, (_, index) => ({
  id: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
  source_id: sourceId,
  file_name: `B${index + 1}.pkl`,
  relative_key: `CALCE/B${index + 1}.pkl`,
  parent_battery_id: null,
  metadata: { chemistry: "LCO", nominal_capacity_ah: 1.1 + index / 10, temperature_c: 25 },
  availability: "available",
  file_size_bytes: 1024,
  modified_at_ns: 1792915200000000000,
  created_at: now,
}))
const problematicSplit = {
  id: problematicSplitId,
  name: "Incomplete built-in dataset",
  sources: [{ source_id: sourceId, source_revision: 1, root_alias: "battery_life" }],
  origin: "builtin",
  source_ref: "datasets/batteryLife/data_split/incomplete.json",
  read_only: true,
  execution_ready: false,
  resolution: {
    matched: 2,
    missing: 1,
    ambiguous: 0,
    duplicates: 0,
    issues: [{ file_name: "MISSING.pkl", status: "missing", candidates: [] }],
  },
  revision: 1,
  head_version: 1,
  version: 1,
  counts: { train: 1, val: 1, test: 1 },
  payload: {
    provider_split: {
      dataset: "Incomplete built-in dataset",
      train: ["MISSING.pkl"],
      val: ["B4.pkl"],
      test: ["B5.pkl"],
    },
  },
  statistics: null,
  created_at: now,
}
const components = [
  ["task", "BatteryLifeRun"],
  ["runtime", "accelerator"],
  ["datafactory", "BatteryLandBatteryLifeDatasetFactory"],
  ["model", "CPMLP"],
  ["optimizers", "adamBuilder"],
  ["schedulers", "oneCycleLRBuilder"],
  ["loss", "mse"],
  ["metric", "mape"],
  ["metric", "mae"],
  ["validate", "batteryLifeValidate"],
].map(([scope, type], index) => ({
  id: `component-${index}`,
  scope,
  type,
  provider_commit: "provider-commit",
  source_hash: `hash-${index}`,
  origin: "builtin",
  resource_ref: null,
  schema:
    scope === "datafactory"
      ? {
          params: [
            {
              name: "split_file",
              annotation: "str | None",
              required: false,
              has_default: true,
              default: null,
              default_serializable: true,
              configurable: false,
            },
          ],
          defaults: { split_file: null },
        }
      : { params: [] },
}))

test("creates a split, validates a config, saves and submits an experiment", async ({ page }) => {
  let split: Record<string, unknown> | null = null
  let importedSplit: Record<string, unknown> | null = null
  let logicalDataset: Record<string, unknown> | null = null
  let experiment: Record<string, unknown> | null = null
  let submitted = false
  let previewRequest: Record<string, unknown> = {}
  let validationRequest: Record<string, unknown> = {}

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace("/api/v1", "")
    const success = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, message: "ok", data }),
      })

    if (request.method() === "GET" && path === "/data-sources") {
      return success({ items: [source], total: 1, page: 1, page_size: 200 })
    }
    if (request.method() === "GET" && path === "/catalog/status") {
      return success({
        state: "ready",
        generation: 1,
        file_count: 10,
        source_count: 1,
        started_at: now,
        completed_at: now,
        error: null,
      })
    }
    if (request.method() === "GET" && path === "/batteries") {
      return success({ items: batteries, total: batteries.length, page: 1, page_size: 120 })
    }
    if (request.method() === "POST" && path === "/logical-datasets/preview") {
      const body = request.postDataJSON() as { source_selections: { battery_ids: string[] }[] }
      const ids = new Set(body.source_selections.flatMap((item) => item.battery_ids))
      const items = batteries.filter((item) => ids.has(item.id))
      return success({ items, total: items.length, page: 1, page_size: 40 })
    }
    if (request.method() === "POST" && path === "/logical-datasets") {
      const body = request.postDataJSON() as Record<string, unknown>
      const selections = body.source_selections as { battery_ids: string[] }[]
      const memberIds = selections.flatMap((item) => item.battery_ids)
      logicalDataset = {
        id: "44444444-4444-4444-8444-444444444444",
        name: body.name,
        description: body.description,
        source_snapshot: [{ source_id: sourceId, source_name: "CALCE", source_revision: 1 }],
        member_count: memberIds.length,
        stale: false,
        created_at: now,
      }
      return success(logicalDataset, 201)
    }
    if (request.method() === "GET" && path === "/logical-datasets") {
      const items = logicalDataset ? [logicalDataset] : []
      return success({ items, total: items.length, page: 1, page_size: 50 })
    }
    if (request.method() === "GET" && path === `/logical-datasets/${logicalDataset?.id}`) {
      return success(logicalDataset)
    }
    if (request.method() === "GET" && path === `/logical-datasets/${logicalDataset?.id}/members`) {
      return success({
        items: batteries.slice(0, Number(logicalDataset?.member_count ?? 0)),
        total: logicalDataset?.member_count ?? 0,
        page: 1,
        page_size: 50,
      })
    }
    if (request.method() === "GET" && path === "/components") return success(components)
    if (request.method() === "GET" && path === "/scheduler/resources") return success([])
    if (request.method() === "GET" && path === "/splits") {
      const items = [split, importedSplit, problematicSplit].filter(
        (item): item is Record<string, unknown> => item !== null,
      )
      return success({ items, total: items.length, page: 1, page_size: 100 })
    }
    if (request.method() === "POST" && path === "/splits/preview") {
      previewRequest = request.postDataJSON() as Record<string, unknown>
      return success({
        source_revisions: { [sourceId]: 1 },
        counts: { all: 5, train: 3, val: 1, test: 1 },
        execution_ready: true,
        resolution: { matched: 5, missing: 0, ambiguous: 0, duplicates: 0, issues: [] },
      })
    }
    if (request.method() === "POST" && path === "/splits/import/preview") {
      return success({
        name: "Imported baseline",
        counts: { train: 3, val: 1, test: 1 },
        resolution: { matched: 5, missing: 0, ambiguous: 0, duplicates: 0, issues: [] },
        execution_ready: true,
      })
    }
    if (request.method() === "POST" && path === "/splits/import") {
      importedSplit = {
        id: "55555555-5555-4555-8555-555555555555",
        name: "Imported baseline",
        sources: [{ source_id: sourceId, source_revision: 1, root_alias: "battery_life" }],
        origin: "imported",
        source_ref: null,
        read_only: false,
        execution_ready: true,
        resolution: { matched: 5, missing: 0, ambiguous: 0, duplicates: 0, issues: [] },
        revision: 1,
        head_version: 1,
        version: 1,
        counts: { train: 3, val: 1, test: 1 },
        payload: null,
        statistics: null,
        created_at: now,
      }
      return success(importedSplit, 201)
    }
    if (request.method() === "PUT" && path === "/splits/55555555-5555-4555-8555-555555555555") {
      const body = request.postDataJSON() as Record<string, unknown>
      importedSplit = {
        ...importedSplit,
        name: body.name,
        revision: 2,
        head_version: 2,
        version: 2,
      }
      return success(importedSplit)
    }
    if (request.method() === "POST" && path === "/splits") {
      const body = request.postDataJSON() as Record<string, unknown>
      split = {
        id: splitId,
        name: body.name,
        sources: [{ source_id: sourceId, source_revision: 1, root_alias: "battery_life" }],
        origin: "created",
        source_ref: null,
        read_only: false,
        execution_ready: true,
        resolution: { matched: 5, missing: 0, ambiguous: 0, duplicates: 0, issues: [] },
        revision: 1,
        head_version: 1,
        version: 1,
        counts: { train: 3, val: 1, test: 1 },
        payload: null,
        statistics: null,
        created_at: now,
      }
      return success(split, 201)
    }
    if (request.method() === "GET" && path === `/splits/${splitId}`) return success(split)
    if (request.method() === "GET" && path === `/splits/${problematicSplitId}`)
      return success(problematicSplit)
    if (request.method() === "GET" && path === `/splits/${String(importedSplit?.id ?? "")}`)
      return success(importedSplit)
    if (request.method() === "GET" && path === `/splits/${problematicSplitId}/members`)
      return success({ items: [], total: 0, page: 1, page_size: 100 })
    if (request.method() === "GET" && path === "/splits/55555555-5555-4555-8555-555555555555/members") {
      const partition = url.searchParams.get("partition")
      const names =
        partition === "train" ? ["B1.pkl", "B2.pkl", "B3.pkl"] : partition === "val" ? ["B4.pkl"] : ["B5.pkl"]
      const items = batteries.filter((item) => names.includes(item.file_name))
      return success({ items, total: items.length, page: 1, page_size: 100 })
    }
    if (request.method() === "GET" && path === `/splits/${splitId}/members`) {
      const partition = url.searchParams.get("partition")
      const query = url.searchParams.get("q")?.toLocaleLowerCase() ?? ""
      const names =
        partition === "train" ? ["B1.pkl", "B2.pkl", "B3.pkl"] : partition === "val" ? ["B4.pkl"] : ["B5.pkl"]
      const items = batteries
        .filter(
          (item) => names.includes(item.file_name) && item.file_name.toLocaleLowerCase().includes(query),
        )
        .map((item) => (item.file_name === "B2.pkl" ? { ...item, availability: "missing" } : item))
      return success({ items, total: items.length, page: 1, page_size: 100 })
    }
    if (request.method() === "POST" && path === "/training/validation") {
      validationRequest = request.postDataJSON() as Record<string, unknown>
      return success({
        valid: true,
        config: {},
        split: { dataset: "实验数据划分", train: [], val: [], test: [] },
        split_text: JSON.stringify({ dataset: "实验数据划分", train: [], val: [], test: [] }),
        split_id: splitId,
        split_version: 1,
        receipt: { execution_supported: true, signature: "fixture" },
        execution_supported: true,
        limitations: [],
      })
    }
    if (request.method() === "POST" && path === "/validated-experiments") {
      const body = request.postDataJSON() as Record<string, unknown>
      experiment = {
        id: experimentId,
        name: body.name,
        state: "draft",
        revision: 1,
        version: 1,
        requested_device: "auto",
        resolved_device: null,
        actual_device: null,
        actual_gpu_uuid: null,
        experiment_id: experimentId,
        config_text: body.config_text,
        split_text: body.split_text,
        split_id: splitId,
        split_version: 1,
        config_sha256: "config-hash",
        split_sha256: "split-hash",
        config: {},
        split: {},
        split_counts: { train: 3, val: 1, test: 1 },
        receipt: { execution_supported: true, signature: "fixture" },
        provider_commit: "provider-commit",
        created_at: now,
      }
      return success(experiment, 201)
    }
    if (request.method() === "POST" && path === `/validated-experiments/${experimentId}/submit`) {
      submitted = true
      experiment = { ...experiment, state: "queued" }
      return success(experiment, 202)
    }
    if (request.method() === "GET" && path === `/validated-experiments/${experimentId}`) {
      return success(experiment)
    }
    if (request.method() === "GET" && path === `/experiments/${experimentId}/artifacts`) {
      return success([])
    }
    if (request.method() === "GET" && path === `/experiments/${experimentId}/logs`) {
      return success({
        stream: "console",
        text: "",
        next_cursor: "0",
        eof: false,
        state: submitted ? "queued" : "draft",
      })
    }
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: `Unmocked ${request.method()} ${path}` }),
    })
  })

  await page.goto("/batteries")
  const themeRoot = page.locator('[data-component="ThemeProvider"]')
  await page.setViewportSize({ width: 700, height: 900 })
  await page.getByRole("button", { name: "设置" }).click()
  await page.getByText("深色主题", { exact: true }).click()
  await expect(themeRoot).toHaveAttribute("data-color-mode", "dark")
  await expect(page.locator(".workbench")).toHaveCSS("background-color", "rgb(13, 17, 23)")
  await page.reload()
  await expect(themeRoot).toHaveAttribute("data-color-mode", "dark")
  await page.getByRole("button", { name: "设置" }).click()
  await page.getByText("浅色主题", { exact: true }).click()
  await expect(themeRoot).toHaveAttribute("data-color-mode", "light")
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(page.getByText("电池实验与数据管理", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("heading", { name: "电池目录" })).toBeVisible()
  await page.getByRole("button", { name: "打开", exact: true }).click()
  const firstFile = page.getByRole("button", { name: "选择 B1.pkl" })
  const secondFile = page.getByRole("button", { name: "选择 B2.pkl" })
  const firstBox = await firstFile.boundingBox()
  const secondBox = await secondFile.boundingBox()
  if (!firstBox || !secondBox) throw new Error("Battery file items are not visible")
  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2, { steps: 4 })
  await page.mouse.up()
  await expect(page.getByRole("button", { name: "取消选择 B1.pkl" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: "取消选择 B2.pkl" })).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: "清空", exact: true }).click()
  await page.getByRole("button", { name: "列表", exact: true }).click()
  for (const name of ["B1.pkl", "B2.pkl", "B3.pkl", "B4.pkl", "B5.pkl"]) {
    const checkbox = page.getByRole("checkbox", { name: `选择 ${name}` })
    await checkbox.check()
    await expect(checkbox).toBeChecked()
  }
  await page.getByRole("button", { name: "保存为逻辑数据集", exact: true }).click()
  await page.getByRole("textbox", { name: "逻辑数据集名称" }).fill("Selected CALCE cells")
  await page.getByRole("button", { name: "保存到数据库" }).click()
  await page.getByRole("button", { name: "Selected CALCE cells", exact: true }).click()
  await page.getByRole("button", { name: "创建数据划分" }).click()

  await expect(page.getByRole("heading", { name: "新建数据集" })).toBeVisible()
  await page.getByRole("button", { name: "预览划分" }).click()
  await expect(page.getByRole("textbox", { name: "划分名称" })).toHaveValue("实验数据划分")
  await page.getByRole("button", { name: "保存数据集" }).click()
  await expect(page.getByRole("heading", { name: "实验数据划分" })).toBeVisible()
  await page.getByRole("button", { name: "查看电池成员" }).click()
  await expect(page.getByRole("button", { name: /训练集/ })).toHaveAttribute("aria-pressed", "true")
  const missingMember = page.getByRole("row").filter({ hasText: "B2.pkl" })
  await expect(missingMember).toContainText("文件不存在")
  await expect(missingMember).toHaveClass(/is-missing/)
  await page.getByRole("textbox", { name: "搜索电池成员" }).fill("B2")
  await expect(missingMember).toBeVisible()
  await page.getByRole("textbox", { name: "搜索电池成员" }).fill("B1")
  await expect(missingMember).toHaveCount(0)
  await page.getByRole("button", { name: "用于新实验" }).click()

  await expect(page.getByRole("heading", { name: "新建实验" })).toBeVisible()
  await page.getByRole("button", { name: "校验配置" }).click()
  await expect(page.getByText("配置已通过校验")).toBeVisible()
  await page.getByRole("button", { name: "保存实验" }).click()
  await expect(page.getByRole("heading", { name: "实验数据划分 实验" })).toBeVisible()
  await page.getByRole("button", { name: "提交训练" }).click()
  await expect(page.getByText("排队中")).toBeVisible()

  expect(previewRequest.logical_dataset_id).toBe("44444444-4444-4444-8444-444444444444")
  expect(previewRequest.source_selections).toEqual([])
  expect(validationRequest.split_id).toBe(splitId)
  const configText = String(validationRequest.config_text)
  expect(configText).toContain("BatteryLandBatteryLifeDatasetFactory")
  expect(configText).toContain("eval_cycle_max: 100")
  expect(configText).toContain("used_metric:")
  expect(configText).not.toContain("split_file")
  expect(submitted).toBe(true)

  await page.goto("/splits")
  await page.getByRole("button", { name: "导入 JSON" }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: "baseline.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        dataset: "Imported baseline",
        train: ["B1.pkl", "B2.pkl", "B3.pkl"],
        val: ["B4.pkl"],
        test: ["B5.pkl"],
      }),
    ),
  })
  await expect(page.getByText("所有成员已唯一匹配，可以导入。", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "导入数据集", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Imported baseline" })).toBeVisible()
  await page.getByRole("button", { name: "编辑数据集", exact: true }).click()
  await expect(page.getByRole("heading", { name: "编辑数据集划分" })).toBeVisible()
  await page.getByRole("button", { name: "预览划分" }).click()
  await page.getByRole("button", { name: "保存新版本" }).click()
  await expect(page.getByText("v2", { exact: true })).toBeVisible()
  await page.goto(`/splits?open=${problematicSplitId}`)
  await expect(page.getByRole("heading", { name: "Incomplete built-in dataset" })).toBeVisible()
  await page.getByRole("button", { name: "查看电池成员" }).click()
  await expect(page.getByText("MISSING.pkl", { exact: true })).toBeVisible()
  await expect(page.getByText("未找到文件", { exact: true })).toBeVisible()
  await page.goto("/splits")
  const splitActions = page.locator(".split-actions")
  await expect(splitActions.getByRole("button", { name: "导入 JSON" })).toBeVisible()
  await expect(splitActions.getByRole("button", { name: "新建数据集" })).toBeVisible()
})
