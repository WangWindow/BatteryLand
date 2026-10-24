import i18n from "@/i18n"

const STATE_TONES: Record<
  string,
  "default" | "secondary" | "destructive" | "outline" | "success" | "warning"
> = {
  draft: "outline",
  queued: "secondary",
  starting: "warning",
  running: "default",
  stopping: "warning",
  stopped: "outline",
  cancelled: "outline",
  succeeded: "success",
  failed: "destructive",
  needs_reconciliation: "destructive",
}

export function stateLabel(state: string | null | undefined): string {
  if (!state) {
    return i18n.t("common.unknown")
  }
  return i18n.t(`common.state.${state}`, { defaultValue: state })
}

export function stateTone(
  state: string | null | undefined,
): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" {
  if (!state) {
    return "outline"
  }
  return STATE_TONES[state] ?? "outline"
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "—"
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat(i18n.resolvedLanguage === "en" ? "en-US" : "zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—"
  }
  if (value < 1024) {
    return `${value} B`
  }
  const units = ["KiB", "MiB", "GiB", "TiB"]
  let size = value
  let unit = "B"
  for (const next of units) {
    if (size < 1024) {
      break
    }
    size /= 1024
    unit = next
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${unit}`
}

export function formatMetric(value: number | null | undefined, unit?: string | null): string {
  if (value === null || value === undefined) {
    return i18n.t("common.unavailable")
  }
  const text = Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "")
  return unit && unit !== "unknown" ? `${text} ${unit}` : text
}

export function enumLabel(
  value: string | null | undefined,
  group: "kinds" | "collection" | "availability" | "stages" | "artifactKinds" | "state",
): string {
  if (!value) {
    return "—"
  }
  return i18n.t(`common.${group}.${value}`, { defaultValue: value })
}

export function shortId(value: string | null | undefined): string {
  if (!value) {
    return "—"
  }
  return value.slice(0, 8)
}

export function filenameOf(value: string): string {
  return value.split("/").pop() || value
}
