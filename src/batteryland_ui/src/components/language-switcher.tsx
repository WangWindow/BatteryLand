import { LanguagesIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { LANGUAGES, type Language } from "@/i18n/languages"

export function LanguageSwitcher({
  compact = false,
  collapsed = false,
}: {
  compact?: boolean
  collapsed?: boolean
}) {
  const { t, i18n } = useTranslation()
  const current: Language = i18n.resolvedLanguage === "en" ? "en" : "zh-CN"
  return (
    <Select value={current} onValueChange={(value: Language) => void i18n.changeLanguage(value)}>
      <SelectTrigger
        className={
          collapsed
            ? "w-8 justify-center px-0 [&>svg:last-child]:hidden"
            : compact
              ? "w-32"
              : "w-full"
        }
        aria-label={t("common.language")}
        title={collapsed ? t("common.language") : undefined}
      >
        <LanguagesIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        <SelectValue className={collapsed ? "sr-only" : undefined} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {LANGUAGES.map((language) => (
            <SelectItem key={language.value} value={language.value}>
              {t(language.labelKey)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
