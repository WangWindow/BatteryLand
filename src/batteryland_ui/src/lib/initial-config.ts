import { stringify } from "yaml"
import type { Component } from "../api/types"

type Config = Record<string, unknown>

function componentType(components: Component[], scope: string, preferred: string): string {
  const matches = components.filter((item) => item.scope === scope)
  return (
    matches.find((item) => item.type.toLowerCase() === preferred.toLowerCase())?.type ??
    matches[0]?.type ??
    preferred
  )
}

export function initialConfig(components: Component[], splitName: string): string {
  const type = (scope: string, preferred: string) => componentType(components, scope, preferred)
  const metricTypes = ["mape", "mae", "rmse"]
    .map((name) => components.find((item) => item.scope === "metric" && item.type.toLowerCase() === name))
    .filter((item): item is Component => Boolean(item))
  const metricReferences = Object.fromEntries(
    metricTypes.map((item) => [item.type.toLowerCase(), `@${item.type.toLowerCase()}`]),
  )
  const earlyStop = components.find(
    (item) => item.scope === "others" && item.type.toLowerCase() === "earlystop",
  )
  const modelType = type("model", "CPMLP")
  const datafactoryType = type("datafactory", "BatteryLandBatteryLifeDatasetFactory")
  const config: Config = {
    mate: { seed: 42, device: "auto", experiment: "BatteryLand", epochs: 100, lr: 0.0001 },
    task: { type: type("task", "BatteryLifeRun") },
    runtime: { type: type("runtime", "accelerator"), name: "accelerator", params: { device: "@device" } },
    datafactory: {
      type: datafactoryType,
      params: {
        dataset: splitName,
        batch_size: 16,
        num_workers: 8,
        root_path: "datasets/batteryLife",
        seq_len: 1,
        eval_cycle_min: 1,
        eval_cycle_max: 100,
        charge_discharge_len: 300,
        early_cycle_threshold: 100,
        weighted_loss: false,
      },
    },
    model: {
      type: modelType,
      name: "model",
      params:
        modelType.toLowerCase() === "cpmlp"
          ? {
              d_ff: 256,
              d_model: 128,
              charge_discharge_length: 300,
              early_cycle_threshold: 100,
              dropout: 0,
              e_layers: 4,
              d_layers: 2,
            }
          : {},
    },
    optimizers: {
      type: type("optimizers", "adamBuilder"),
      name: "optimizer",
      params: { model: "@model", lr: "@lr" },
    },
    schedulers: {
      type: type("schedulers", "oneCycleLRBuilder"),
      name: "scheduler",
      params: { train_epochs: "@epochs", max_lr: "@lr" },
    },
    loss: { type: type("loss", "mse") },
    metric: metricTypes.map((item) => ({ type: item.type })),
    validate: {
      type: type("validate", "batteryLifeValidate"),
      params: { used_metric: metricReferences },
    },
    others: earlyStop
      ? [
          {
            type: earlyStop.type,
            name: "early_stop",
            params: {
              enable: true,
              patience: 5,
              least_epoch: 5,
              monitor: metricTypes[0]?.type.toLowerCase() ?? "mape",
              which_is_better: "less",
            },
          },
        ]
      : [],
  }
  return stringify(config, { lineWidth: 100 })
}
