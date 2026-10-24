import {
  BoxesIcon,
  ChartLineIcon,
  ChevronDownIcon,
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
      { to: "/resources", labelKey: "common.nav.resources", icon: DatabaseIcon },
      { to: "/splits", labelKey: "common.nav.splits", icon: LayersIcon },
      { to: "/templates", labelKey: "common.nav.templates", icon: FileJsonIcon },
      { to: "/components", labelKey: "common.nav.components", icon: BoxesIcon },
    ],
  },
  {
    labelKey: "common.nav.groupExecute",
    icon: FlaskConicalIcon,
    items: [
      { to: "/experiments", labelKey: "common.nav.experiments", icon: FlaskConicalIcon },
      { to: "/queue", labelKey: "common.nav.queue", icon: ListOrderedIcon },
    ],
  },
  {
    labelKey: "common.nav.groupAnalyze",
    icon: ChartLineIcon,
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
      <aside
        id="workbench-sidebar"
        className="hidden border-r bg-sidebar md:sticky md:top-0 md:flex md:h-svh md:flex-col"
      >
        <div
          className={cn(
            "flex h-14 flex-nowrap items-center border-b",
            sidebarCollapsed ? "justify-center gap-1 px-1" : "justify-between gap-2 px-4",
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
          <Button
            aria-controls="workbench-sidebar"
            aria-expanded={!sidebarCollapsed}
            aria-label={
              sidebarCollapsed ? t("common.nav.expandSidebar") : t("common.nav.collapseSidebar")
            }
            className={sidebarCollapsed ? "size-6" : undefined}
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
