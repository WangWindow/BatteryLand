export const partitions = ["train", "val", "test"] as const
export const partLabel = { train: "训练集", val: "验证集", test: "测试集" }
export const categories: Record<string, string> = {
  task: "任务",
  model: "模型",
  datafactory: "数据处理",
  optimizers: "优化器",
  schedulers: "学习率调度",
  loss: "损失函数",
  metric: "评估指标",
  runtime: "运行环境",
  others: "扩展组件",
  validate: "验证器",
}
export const metadataNames: Record<string, string> = {
  chemistry: "化学体系",
  material: "材料",
  temperature_c: "温度 (°C)",
  nominal_capacity_ah: "标称容量 (Ah)",
  cycle_count: "循环次数",
  cycle_life: "循环寿命",
}
export const sourcePalette = ["#0969da", "#1a7f37", "#8250df", "#bc4c00", "#bf3989", "#0a7f83"]
export function sourceColor(id: string): string {
  const hash = [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0)
  return sourcePalette[hash % sourcePalette.length]
}
export function display(value: unknown): string {
  return value === null || value === undefined || value === ""
    ? "—"
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value)
}
export function number(value: unknown): string {
  return typeof value === "number"
    ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value)
    : "—"
}
export function bytes(value?: number | null): string {
  if (value == null) return "—"
  if (value < 1024) return `${value} B`
  const i = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)))
  return `${(value / 1024 ** i).toFixed(1)} ${["B", "KB", "MB", "GB"][i]}`
}
export function date(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
}
