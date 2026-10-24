import { Settings2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { AppearancePreference } from "@/components/appearance"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LANGUAGES, type Language } from "@/i18n/languages"

type SettingsMenuProps = {
  appearance: AppearancePreference
  onAppearanceChange: (preference: AppearancePreference) => void
  collapsed?: boolean
  compact?: boolean
}

export function SettingsMenu({
  appearance,
  onAppearanceChange,
  collapsed = false,
  compact = false,
}: SettingsMenuProps) {
  const { t, i18n } = useTranslation()
  const currentLanguage: Language = i18n.resolvedLanguage === "en" ? "en" : "zh-CN"
  const iconOnly = collapsed || compact

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("common.settings.title")}
          className={iconOnly ? "w-8" : "w-full justify-start"}
          size={iconOnly ? "icon" : "sm"}
          title={iconOnly ? t("common.settings.title") : undefined}
          type="button"
          variant="ghost"
        >
          <Settings2Icon aria-hidden="true" />
          {!iconOnly && <span>{t("common.settings.title")}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={compact ? "end" : "start"}
        className="min-w-48"
        side={compact ? "bottom" : "top"}
      >
        <DropdownMenuLabel>{t("common.settings.title")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("common.language")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={currentLanguage}
          onValueChange={(value) => void i18n.changeLanguage(value as Language)}
        >
          {LANGUAGES.map((language) => (
            <DropdownMenuRadioItem
              key={language.value}
              value={language.value}
              onSelect={() => void i18n.changeLanguage(language.value)}
            >
              {t(language.labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("common.settings.appearance")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={appearance}
          onValueChange={(value) => onAppearanceChange(value as AppearancePreference)}
        >
          <DropdownMenuRadioItem value="light" onSelect={() => onAppearanceChange("light")}>
            {t("common.settings.theme.light")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" onSelect={() => onAppearanceChange("dark")}>
            {t("common.settings.theme.dark")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system" onSelect={() => onAppearanceChange("system")}>
            {t("common.settings.theme.system")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
