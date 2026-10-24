import { act, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { StatusBadge } from "@/components/status-badge"
import i18n from "@/i18n"
import { messagesEn, messagesZh } from "@/i18n/messages"

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const result = new Map<string, string>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === "string") {
      result.set(path, value)
    } else {
      for (const [nested, text] of flatten(value, path)) {
        result.set(nested, text)
      }
    }
  }
  return result
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((match) => match[1]).sort()
}

afterEach(async () => {
  await i18n.changeLanguage("zh-CN")
})

describe("translation catalogs", () => {
  it("keep exactly the same key tree", () => {
    const zh = flatten(messagesZh as Tree)
    const en = flatten(messagesEn as Tree)
    expect([...en.keys()].sort()).toEqual([...zh.keys()].sort())
  })

  it("keep the same interpolation placeholders", () => {
    const zh = flatten(messagesZh as Tree)
    const en = flatten(messagesEn as Tree)
    for (const [key, value] of zh) {
      const english = en.get(key)
      expect(english, key).toBeDefined()
      expect(placeholders(english ?? ""), key).toEqual(placeholders(value))
    }
  })

  it("switch document language and translate status text", async () => {
    await act(async () => {
      await i18n.changeLanguage("en")
    })
    expect(document.documentElement.lang).toBe("en")
    expect(localStorage.getItem("batteryland.language")).toBe("en")
    render(<StatusBadge state="running" />)
    expect(screen.getByText("Running")).toBeInTheDocument()
    expect(i18n.t("common.state.needs_reconciliation")).toBe("Needs reconciliation")

    await act(async () => {
      await i18n.changeLanguage("zh-CN")
    })
    expect(screen.getByText("运行中")).toBeInTheDocument()
  })
})
