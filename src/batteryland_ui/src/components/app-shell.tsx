import {
  BoxesIcon,
  ChartLineIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DatabaseIcon,
  FlaskConicalIcon,
  LayersIcon,
  ListOrderedIcon,
} from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { NavLink, Outlet, useLocation } from "react-router-dom"

import {
  APPEARANCE_QUERY,
  type AppearancePreference,
  applyAppearancePreference,
  readAppearancePreference,
} from "@/components/appearance"
import { SettingsMenu } from "@/components/settings-menu"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const SIDEBAR_STORAGE_KEY = "batteryland.sidebar.collapsed"

const NAV_GROUPS = [
  {
    labelKey: "common.nav.groupPrepare",
    icon: DatabaseIcon,
    items: [
      { to: "/resources", labelKey: "workflow.nav.datasets", icon: DatabaseIcon },
      { to: "/splits", labelKey: "workflow.nav.splits", icon: LayersIcon },
      { to: "/components", labelKey: "workflow.nav.components", icon: BoxesIcon },
    ],
  },
  {
    labelKey: "common.nav.groupExecute",
    icon: FlaskConicalIcon,
    items: [
      { to: "/experiments", labelKey: "workflow.nav.experiments", icon: FlaskConicalIcon },
      { to: "/queue", labelKey: "workflow.nav.queue", icon: ListOrderedIcon },
    ],
  },
  {
    labelKey: "common.nav.groupAnalyze",
    icon: ChartLineIcon,
    items: [{ to: "/compare", labelKey: "workflow.nav.compare", icon: ChartLineIcon }],
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
  const { pathname } = useLocation()
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const activeGroup = NAV_GROUPS.find((group) =>
      group.items.some(({ to }) => pathname === to || pathname.startsWith(`${to}/`)),
    )
    if (activeGroup) {
      setExpandedGroups((current) => ({ ...current, [activeGroup.labelKey]: true }))
    }
  }, [pathname])

  return (
    <nav
      aria-label={t("common.nav.mainAria")}
      className={compact ? "flex gap-1 overflow-x-auto" : "flex flex-col gap-3"}
    >
      {NAV_GROUPS.map((group, index) => {
        const active = group.items.some(
          ({ to }) => pathname === to || pathname.startsWith(`${to}/`),
        )
        const expanded = expandedGroups[group.labelKey] ?? active
        const groupId = `workbench-nav-group-${index}`
        const showItems = compact || collapsed || expanded

        return (
          <div key={group.labelKey} className={compact ? "contents" : "flex flex-col gap-1"}>
            {!compact && !collapsed ? (
              <Button
                aria-controls={groupId}
                aria-expanded={expanded}
                className={cn(
                  "w-full justify-start px-2 text-xs font-medium text-muted-foreground hover:text-foreground",
                  active && "text-foreground",
                )}
                onClick={() =>
                  setExpandedGroups((current) => ({
                    ...current,
                    [group.labelKey]: !expanded,
                  }))
                }
                type="button"
                title={t(group.labelKey)}
                variant="ghost"
              >
                <group.icon aria-hidden="true" />
                <span className="flex-1 text-left">{t(group.labelKey)}</span>
                <ChevronDownIcon
                  aria-hidden="true"
                  className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
                />
              </Button>
            ) : null}
            <div
              id={groupId}
              hidden={!showItems}
              className={cn(
                compact ? "contents" : "flex flex-col gap-1",
                !compact && !collapsed && "pl-2",
              )}
            >
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
          </div>
        )
      })}
    </nav>
  )
}

export function AppShell() {
  const { t } = useTranslation()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true",
  )
  const [appearance, setAppearance] = useState<AppearancePreference>(readAppearancePreference)

  useEffect(() => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed))
  }, [sidebarCollapsed])

  useEffect(() => {
    localStorage.setItem("batteryland.appearance", appearance)
    applyAppearancePreference(appearance)

    if (appearance !== "system") {
      return
    }
    const media = window.matchMedia(APPEARANCE_QUERY)
    const applySystemAppearance = () => applyAppearancePreference("system")
    media.addEventListener("change", applySystemAppearance)
    return () => media.removeEventListener("change", applySystemAppearance)
  }, [appearance])

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
      <div className="relative hidden h-svh md:sticky md:top-0 md:block">
        <aside id="workbench-sidebar" className="flex h-full flex-col border-r bg-sidebar">
          <div
            className={cn(
              "flex h-14 flex-nowrap items-center border-b",
              sidebarCollapsed ? "justify-center px-1" : "justify-start px-4",
            )}
          >
            <span
              role="img"
              aria-label={t("common.appName")}
              className={cn(
                "flex shrink-0 items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground",
                sidebarCollapsed ? "size-6 text-[0.625rem]" : "size-8 text-sm",
              )}
            >
              BL
            </span>
          </div>
          <div className={cn("flex-1 overflow-y-auto py-3", sidebarCollapsed ? "px-2" : "px-3")}>
            <Navigation collapsed={sidebarCollapsed} />
          </div>
          <div
            className={cn("border-t py-3", sidebarCollapsed ? "flex justify-center px-2" : "px-3")}
          >
            <SettingsMenu
              appearance={appearance}
              onAppearanceChange={setAppearance}
              collapsed={sidebarCollapsed}
            />
          </div>
        </aside>
        <Button
          aria-controls="workbench-sidebar"
          aria-expanded={!sidebarCollapsed}
          aria-label={
            sidebarCollapsed ? t("common.nav.expandSidebar") : t("common.nav.collapseSidebar")
          }
          className="absolute top-1/2 -right-4 z-30 hidden size-8 -translate-y-1/2 rounded-full border-sidebar-border bg-sidebar text-sidebar-foreground shadow-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground md:inline-flex"
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          size="icon"
          title={sidebarCollapsed ? t("common.nav.expandSidebar") : t("common.nav.collapseSidebar")}
          type="button"
          variant="outline"
        >
          {sidebarCollapsed ? (
            <ChevronRightIcon aria-hidden="true" className="size-4" />
          ) : (
            <ChevronLeftIcon aria-hidden="true" className="size-4" />
          )}
        </Button>
      </div>
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
            <SettingsMenu appearance={appearance} onAppearanceChange={setAppearance} compact />
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
