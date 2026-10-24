import { defineMessages } from "@/i18n/messages/types"

export const visualizerMessages = defineMessages({
  zh: {
    visualizer: {
      noDataTitle: "没有可绘制数据",
      noDataDescription: "调整指标、阶段或集合选择。",
      unitSuffix: "（{{unit}}）",
      unknownUnit: "（单位未知）",
      sampled: "已采样 · 每序列最多 1000 点（原始 {{count}}）",
      noChartsTitle: "没有匹配的图表",
      noChartsDescription: "调整指标、阶段或集合选择。",
    },
  },
  en: {
    visualizer: {
      noDataTitle: "No plottable data",
      noDataDescription: "Adjust the metric, stage, or set selection.",
      unitSuffix: " ({{unit}})",
      unknownUnit: " (unit unknown)",
      sampled: "Sampled · max 1,000 points per series (original {{count}})",
      noChartsTitle: "No matching charts",
      noChartsDescription: "Adjust the metric, stage, or set selection.",
    },
  },
})
