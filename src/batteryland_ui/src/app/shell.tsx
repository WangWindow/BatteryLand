import {
  BeakerIcon,
  DatabaseIcon,
  GearIcon,
  GraphIcon,
  MoonIcon,
  PackageIcon,
  PulseIcon,
  SunIcon,
  WorkflowIcon,
} from "@primer/octicons-react"
import { ActionList, ActionMenu, BaseStyles, NavList } from "@primer/react"
import { useTheme } from "@primer/react/next"
import { Link, NavLink, Outlet, useLocation } from "react-router-dom"

const nav = [
  {
    label: "数据",
    pages: [
      { to: "/batteries", name: "电池目录", icon: DatabaseIcon },
      { to: "/splits", name: "数据划分", icon: WorkflowIcon },
    ],
  },
  {
    label: "实验",
    pages: [
      { to: "/experiments", name: "实验", icon: BeakerIcon },
      { to: "/components", name: "组件库", icon: PackageIcon },
      { to: "/scheduler", name: "任务与资源", icon: PulseIcon },
    ],
  },
  {
    label: "分析",
    pages: [
      { to: "/analysis/datasets", name: "数据集比较", icon: GraphIcon },
      { to: "/analysis/experiments", name: "实验结果比较", icon: GraphIcon },
    ],
  },
]

export function Shell() {
  const location = useLocation()
  const { colorMode, setColorMode } = useTheme()
  const isDark = colorMode === "night" || colorMode === "dark"

  function chooseColorMode(mode: "day" | "night") {
    setColorMode(mode)
    try {
      window.localStorage.setItem("batteryland.color-mode", mode)
    } catch {
      // Theme changes still work when browser storage is unavailable.
    }
  }

  return (
    <BaseStyles>
      <div className="workbench">
        <a className="skip-link" href="#main">
          跳到主内容
        </a>
        <aside className="sidebar">
          <Link to="/batteries" className="brand">
            <BeakerIcon size={23} />
            <span>BatteryLand</span>
          </Link>
          <NavList aria-label="主导航">
            {nav.map((group) => (
              <NavList.Group key={group.label}>
                <NavList.GroupHeading>{group.label}</NavList.GroupHeading>
                {group.pages.map((page) => (
                  <NavList.Item
                    key={page.to}
                    as={NavLink}
                    to={page.to}
                    aria-current={location.pathname.startsWith(page.to) ? "page" : undefined}
                  >
                    <NavList.LeadingVisual>
                      <page.icon />
                    </NavList.LeadingVisual>
                    {page.name}
                  </NavList.Item>
                ))}
              </NavList.Group>
            ))}
          </NavList>
          <div className="sidebar-settings">
            <ActionMenu>
              <ActionMenu.Button
                aria-label="设置"
                leadingVisual={GearIcon}
                trailingAction={null}
                className="sidebar-settings-button"
              >
                <span className="sidebar-settings-label">设置</span>
              </ActionMenu.Button>
              <ActionMenu.Overlay side="outside-top" align="start">
                <ActionList selectionVariant="single">
                  <ActionList.Group title="主题">
                    <ActionList.Item selected={!isDark} onSelect={() => chooseColorMode("day")}>
                      <ActionList.LeadingVisual>
                        <SunIcon />
                      </ActionList.LeadingVisual>
                      浅色主题
                    </ActionList.Item>
                    <ActionList.Item selected={isDark} onSelect={() => chooseColorMode("night")}>
                      <ActionList.LeadingVisual>
                        <MoonIcon />
                      </ActionList.LeadingVisual>
                      深色主题
                    </ActionList.Item>
                  </ActionList.Group>
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>
          </div>
        </aside>
        <div className="workspace">
          <main id="main" tabIndex={-1}>
            <Outlet />
          </main>
        </div>
      </div>
    </BaseStyles>
  )
}
