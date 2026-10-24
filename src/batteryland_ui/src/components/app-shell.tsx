import {
  BoxesIcon,
  ChartLineIcon,
  DatabaseIcon,
  FileJsonIcon,
  FlaskConicalIcon,
  LayersIcon,
  ListOrderedIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { NavLink, Outlet } from "react-router-dom"

import { LanguageSwitcher } from "@/components/language-switcher"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const SIDEBAR_STORAGE_KEY = "batteryland.sidebar.collapsed"

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

function Navigation({
  compact = false,
  collapsed = false,
}: {
  compact?: boolean
  collapsed?: boolean
}) {
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
              (compact || collapsed) && "sr-only",
            )}
          >
            {t(group.labelKey)}
          </p>
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              aria-label={t(item.labelKey)}
              className={({ isActive }) =>
                cn(
                  "flex shrink-0 items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                  collapsed && "justify-center px-0",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )
              }
              title={collapsed ? t(item.labelKey) : undefined}
            >
              <item.icon aria-hidden="true" className="size-4" />
              {!collapsed && <span>{t(item.labelKey)}</span>}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )
}

export function AppShell() {
  const { t } = useTranslation()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true",
  )

  useEffect(() => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed))
  }, [sidebarCollapsed])

  return (
    <div
      className={cn(
        "min-h-svh md:grid",
        sidebarCollapsed
          ? "md:grid-cols-[4rem_minmax(0,1fr)]"
          : "md:grid-cols-[13rem_minmax(0,1fr)]",
      )}
    >
      <a
        href="#main-content"
        className="sr-only rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        {t("common.skipToContent")}
      </a>
      <aside
        id="workbench-sidebar"
        className="hidden border-r bg-sidebar md:sticky md:top-0 md:flex md:h-svh md:flex-col"
      >
        <div
          className={cn(
            "flex items-center py-5",
            sidebarCollapsed ? "flex-col gap-3 px-2" : "justify-between gap-2 px-5",
          )}
        >
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
            BL
          </span>
          {!sidebarCollapsed && (
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-sm font-semibold">{t("common.appName")}</span>
              <span className="truncate text-xs text-muted-foreground">
                {t("common.workbench")}
              </span>
            </div>
          )}
          <Button
            aria-controls="workbench-sidebar"
            aria-expanded={!sidebarCollapsed}
            aria-label={
              sidebarCollapsed ? t("common.nav.expandSidebar") : t("common.nav.collapseSidebar")
            }
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            size="icon"
            title={
              sidebarCollapsed ? t("common.nav.expandSidebar") : t("common.nav.collapseSidebar")
            }
            type="button"
            variant="ghost"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpenIcon aria-hidden="true" />
            ) : (
              <PanelLeftCloseIcon aria-hidden="true" />
            )}
          </Button>
        </div>
        <div className={cn("flex-1 overflow-y-auto pb-4", sidebarCollapsed ? "px-2" : "px-3")}>
          <Navigation collapsed={sidebarCollapsed} />
        </div>
        <div
          className={cn(
            "flex flex-col gap-3 border-t py-3",
            sidebarCollapsed ? "items-center px-2" : "px-4",
          )}
        >
          <LanguageSwitcher collapsed={sidebarCollapsed} />
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
