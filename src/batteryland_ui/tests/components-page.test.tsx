import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"

import { endpoints } from "@/api/endpoints"
import i18n from "@/i18n"
import { ComponentsPage } from "@/pages/components-page"

it("requests runtime capabilities only when their details are opened", async () => {
  await i18n.changeLanguage("zh-CN")
  vi.spyOn(endpoints.components, "list").mockResolvedValue([])
  vi.spyOn(endpoints.components, "checkpoints").mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 50,
  })
  const capabilities = vi.spyOn(endpoints.components, "capabilities").mockResolvedValue([])
  render(<ComponentsPage />)
  expect(capabilities).not.toHaveBeenCalled()
  await userEvent.click(screen.getByText(i18n.t("components.capabilitiesTitle")))
  await waitFor(() => expect(capabilities).toHaveBeenCalledTimes(1))
})
