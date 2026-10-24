import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AppShell } from "@/components/app-shell"
import i18n from "@/i18n"

afterEach(async () => {
  vi.restoreAllMocks()
  localStorage.removeItem("batteryland.appearance")
  localStorage.removeItem("batteryland.sidebar.collapsed")
  document.documentElement.classList.remove("dark")
  await i18n.changeLanguage("zh-CN")
})

function renderShell(collapsed = false) {
  localStorage.setItem("batteryland.sidebar.collapsed", String(collapsed))
  localStorage.removeItem("batteryland.appearance")
  return render(
    <MemoryRouter initialEntries={["/queue"]}>
      <Routes>
        <Route path="*" element={<AppShell />} />
      </Routes>
    </MemoryRouter>,
  )
}

function getSettingsButton() {
  const [button] = screen.getAllByRole("button", { name: "设置" })
  if (!button) {
    throw new Error("Settings button is missing")
  }
  return button
}

describe("workbench shell settings", () => {
  it("switches and persists theme from the settings menu", async () => {
    const user = userEvent.setup()
    renderShell()

    await user.click(getSettingsButton())
    await user.click(await screen.findByRole("menuitemradio", { name: "深色" }))

    await waitFor(() => {
      expect(localStorage.getItem("batteryland.appearance")).toBe("dark")
      expect(document.documentElement).toHaveClass("dark")
    })

    await user.click(getSettingsButton())
    await user.click(await screen.findByRole("menuitemradio", { name: "English" }))
    await waitFor(() => {
      expect(document.documentElement.lang).toBe("en")
      expect(localStorage.getItem("batteryland.language")).toBe("en")
    })
  })

  it("keeps the settings menu available and the sidebar title out of the header", () => {
    renderShell()

    expect(screen.getAllByRole("button", { name: "设置" })).toHaveLength(2)
    const sidebar = screen.getByRole("complementary")
    expect(sidebar).not.toHaveTextContent("BatteryLand")
    const sidebarToggle = within(sidebar).getByRole("button", { name: "折叠侧边栏" })
    expect(sidebarToggle.parentElement).toHaveClass("flex-nowrap")
    const sidebarSettings = within(sidebar).getByRole("button", { name: "设置" })
    expect(sidebarSettings.parentElement).toBe(sidebar.lastElementChild)
  })

  it("uses the operating system appearance when that preference is selected", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })

    renderShell()

    expect(document.documentElement).toHaveClass("dark")
  })

  it("opens and closes a secondary navigation group", async () => {
    const user = userEvent.setup()
    renderShell()

    const prepareGroup = screen.getByRole("button", { name: "准备" })
    expect(prepareGroup).toHaveAttribute("aria-expanded", "false")
    await user.click(prepareGroup)

    expect(prepareGroup).toHaveAttribute("aria-expanded", "true")
    expect(screen.getAllByRole("link", { name: "数据来源与电池" })).toHaveLength(2)
  })

  it("keeps every route reachable from the collapsed icon rail", () => {
    renderShell(true)

    const sidebar = screen.getByRole("complementary")
    expect(within(sidebar).getByRole("button", { name: "展开侧边栏" })).toBeInTheDocument()
    expect(within(sidebar).getByRole("link", { name: "数据来源与电池" })).toBeInTheDocument()
    expect(within(sidebar).getByRole("link", { name: "调度队列" })).toBeInTheDocument()
    expect(within(sidebar).getByRole("link", { name: "结果比较" })).toBeInTheDocument()
  })
})
