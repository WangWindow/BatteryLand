import { describe, expect, it } from "vitest"
import { parse } from "yaml"
import type { Component } from "../src/api/types"
import { initialConfig } from "../src/lib/initial-config"

const types: Array<[string, string]> = [
  ["task", "batteryliferun"],
  ["runtime", "accelerator"],
  ["datafactory", "batterylandbatterylifedatasetfactory"],
  ["model", "cpmlp"],
  ["optimizers", "adambuilder"],
  ["schedulers", "onecyclelrbuilder"],
  ["loss", "mse"],
  ["metric", "mape"],
  ["metric", "mae"],
  ["metric", "rmse"],
  ["validate", "batterylifevalidate"],
  ["others", "earlystop"],
]
const components: Component[] = types.map(([scope, type], index) => ({
  id: `component-${index}`,
  provider_commit: "pinned",
  scope,
  type,
  source_hash: `hash-${index}`,
  origin: "builtin",
  resource_ref: null,
  schema: null,
}))

type DefaultConfig = {
  datafactory: { type: string; params: Record<string, unknown> }
  model: { params: Record<string, unknown> }
  optimizers: { params: Record<string, unknown> }
  schedulers: { params: Record<string, unknown> }
  validate: { params: { used_metric: Record<string, string> } }
}

describe("new experiment default config", () => {
  it("includes constructor-required BatteryLife dataset parameters and a matching split name", () => {
    const config = parse(initialConfig(components, "Three batteries")) as DefaultConfig

    expect(config.datafactory.type).toBe("batterylandbatterylifedatasetfactory")
    expect(config.datafactory.params).toMatchObject({
      dataset: "Three batteries",
      eval_cycle_max: 100,
      eval_cycle_min: 1,
      root_path: "datasets/batteryLife",
      seq_len: 1,
      charge_discharge_len: 300,
      early_cycle_threshold: 100,
      weighted_loss: false,
      batch_size: 16,
    })
  })

  it("connects default model, optimizer, scheduler, and validation metrics", () => {
    const config = parse(initialConfig(components, "Three batteries")) as DefaultConfig

    expect(config.model.params).toMatchObject({ d_ff: 256, d_model: 128 })
    expect(config.optimizers.params).toEqual({ model: "@model", lr: "@lr" })
    expect(config.schedulers.params).toEqual({ train_epochs: "@epochs", max_lr: "@lr" })
    expect(config.validate.params.used_metric).toEqual({
      mape: "@mape",
      mae: "@mae",
      rmse: "@rmse",
    })
  })
})
