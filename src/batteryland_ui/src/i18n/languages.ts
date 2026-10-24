export const LANGUAGES = [
  { value: "zh-CN", labelKey: "common.chinese" },
  { value: "en", labelKey: "common.english" },
] as const

export type Language = (typeof LANGUAGES)[number]["value"]
