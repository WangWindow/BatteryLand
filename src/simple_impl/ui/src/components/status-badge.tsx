import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { stateTone } from "@/lib/format"
import { cn } from "@/lib/utils"

const TONE_CLASSES: Record<string, string> = {
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
}

export function StatusBadge({
  state,
  className,
}: {
  state: string | null | undefined
  className?: string
}) {
  const { t } = useTranslation()
  const tone = stateTone(state)
  return (
    <Badge
      variant={tone === "success" || tone === "warning" ? "outline" : tone}
      className={cn(TONE_CLASSES[tone], className)}
    >
      {state ? t(`common.state.${state}`, { defaultValue: state }) : t("common.unknown")}
    </Badge>
  )
}
