import { defineMessages } from "@/i18n/messages/types"

export const workbenchMessages = defineMessages({
  zh: {
    workbench: {
      task: "任务",
      device: "运行设备",
      seed: "随机种子",
      epochs: "训练轮次",
      batchSize: "批大小",
      learningRate: "学习率",
      advancedConfig: "高级配置",
      moreFilters: "更多筛选",
      rawData: "数据明细",
      additionalBindings: "更多输入",
      noSourceOptions: "尚未配置可用的数据目录",
    },
  },
  en: {
    workbench: {
      task: "Task",
      device: "Device",
      seed: "Random seed",
      epochs: "Epochs",
      batchSize: "Batch size",
      learningRate: "Learning rate",
      advancedConfig: "Advanced configuration",
      moreFilters: "More filters",
      rawData: "Data details",
      additionalBindings: "Additional inputs",
      noSourceOptions: "No data directories are configured",
    },
  },
})
