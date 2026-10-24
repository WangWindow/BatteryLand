import {
  BoxesIcon,
  ChartLineIcon,
  DatabaseIcon,
  FileJsonIcon,
  FlaskConicalIcon,
  LayersIcon,
  ListOrderedIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { NavLink, Outlet } from "react-router-dom"

import { LanguageSwitcher } from "@/components/language-switcher"
import { cn } from "@/lib/utils"

const NAV_GROUPS = [
  {
    labelKey: "common.nav.groupPrepare",
    items: [
      { to: "/resources", labelKey: "common.nav.resources", icon: DatabaseIcon },
      { to: "/splits", labelKey: "common.nav.splits", icon: LayersIcon },
      { to: "/templates", labelKey: "common.nav.templates", icon: FileJsonIcon },
      { to: "/components", labelKey: "common.nav.components", icon: BoxesIcon },
    ],
  },
  {
    labelKey: "common.nav.groupExecute",
    items: [
      { to: "/experiments", labelKey: "common.nav.experiments", icon: FlaskConicalIcon },
      { to: "/queue", labelKey: "common.nav.queue", icon: ListOrderedIcon },
    ],
  },
  {
    labelKey: "common.nav.groupAnalyze",
    items: [{ to: "/compare", labelKey: "common.nav.compare", icon: ChartLineIcon }],
  },
]

function Navigation({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  return (
    <nav
      aria-label={t("common.nav.mainAria")}
      className={compact ? "flex gap-1 overflow-x-auto" : "flex flex-col gap-5"}
    >
      {NAV_GROUPS.map((group) => (
        <div key={group.labelKey} className={compact ? "contents" : "flex flex-col gap-1"}>
          <p
            className={cn(
              "px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase",
              compact && "sr-only",
            )}
          >
            {t(group.labelKey)}
          </p>
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex shrink-0 items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )
              }
            >
              <item.icon aria-hidden="true" className="size-4" />
              <span>{t(item.labelKey)}</span>
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )
}

export function AppShell() {
  const { t } = useTranslation()
  return (
    <div className="min-h-svh md:grid md:grid-cols-[13rem_minmax(0,1fr)]">
      <a
        href="#main-content"
        className="sr-only rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        {t("common.skipToContent")}
      </a>
      <aside className="hidden border-r bg-sidebar md:sticky md:top-0 md:flex md:h-svh md:flex-col">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
            BL
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">{t("common.appName")}</span>
            <span className="text-xs text-muted-foreground">{t("common.workbench")}</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          <Navigation />
        </div>
        <div className="flex flex-col gap-3 border-t px-4 py-3">
          <LanguageSwitcher />
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="flex flex-col gap-2 border-b bg-card px-4 py-3 md:hidden">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
                BL
              </span>
              <span className="text-sm font-semibold">
                {t("common.appName")} {t("common.workbench")}
              </span>
            </div>
            <LanguageSwitcher compact />
          </div>
          <Navigation compact />
        </header>
        <main
          id="main-content"
          className="mx-auto flex w-full max-w-[88rem] flex-col gap-5 p-4 sm:p-6 lg:p-7"
        >
          <Outlet />
        </main>
      </div>
    </div>
  )
}
