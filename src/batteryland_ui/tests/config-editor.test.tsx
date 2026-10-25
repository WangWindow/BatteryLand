import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ChangeEvent, ReactNode } from "react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { parse } from "yaml"
import type { Component } from "../src/api/types"
import { ConfigEditor } from "../src/components/config-editor"

vi.mock("../src/api/client", () => ({
  api: {
    componentSchema: vi.fn().mockResolvedValue({
      scope: "datafactory",
      type: "batterylandbatterylifedatasetfactory",
      params: [
        {
          name: "eval_cycle_max",
          annotation: "int",
          required: true,
          has_default: false,
          configurable: true,
        },
        {
          name: "batch_size",
          annotation: "int",
          required: false,
          has_default: true,
          default: 16,
          default_serializable: true,
          configurable: true,
        },
      ],
      defaults: { batch_size: 16 },
    }),
  },
}))

vi.mock("@primer/react", async () => {
  const React = await import("react")
  type Props = {
    children?: ReactNode
    onClick?: () => void
    onChange?: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void
    checked?: boolean
    value?: string
    type?: string
    id?: string
    disabled?: boolean
    "aria-label"?: string
  }
  const Button = ({ children, onClick }: Props) =>
    React.createElement("button", { onClick, type: "button" }, children)
  const Checkbox = ({ checked, onChange, ...props }: Props) =>
    React.createElement("input", { ...props, type: "checkbox", checked, onChange })
  const TextInput = ({ onChange, ...props }: Props) => React.createElement("input", { ...props, onChange })
  const Select = Object.assign(
    ({ children, onChange, value }: Props) => React.createElement("select", { onChange, value }, children),
    { Option: ({ children, value }: Props) => React.createElement("option", { value }, children) },
  )
  const FormControl = Object.assign(
    ({ children }: { children?: ReactNode }) => React.createElement("div", null, children),
    {
      Label: ({ children }: { children?: ReactNode }) => React.createElement("label", null, children),
    },
  )
  return { Button, Checkbox, FormControl, Select, TextInput }
})

const components: Component[] = [
  {
    id: "mape",
    provider_commit: "pinned",
    scope: "metric",
    type: "mape",
    source_hash: "a",
    origin: "builtin",
    resource_ref: null,
    schema: { params: [] },
  },
  {
    id: "mae",
    provider_commit: "pinned",
    scope: "metric",
    type: "mae",
    source_hash: "b",
    origin: "builtin",
    resource_ref: null,
    schema: { params: [] },
  },
]

function EditorHarness() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  const [text, setText] = useState("mate:\n  device: auto\nmetric:\n  - type: mape\n")
  return (
    <QueryClientProvider client={client}>
      <ConfigEditor text={text} components={components} devices={["cuda:0"]} onChange={setText} />
      <output data-testid="serialized-config">{text}</output>
    </QueryClientProvider>
  )
}

function DatafactoryEditorHarness() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  const [text, setText] = useState(
    "datafactory:\n  type: batterylandbatterylifedatasetfactory\n  params: {}\n",
  )
  const datafactory: Component = {
    id: "datafactory",
    provider_commit: "pinned",
    scope: "datafactory",
    type: "batterylandbatterylifedatasetfactory",
    source_hash: "c",
    origin: "builtin",
    resource_ref: null,
    schema: null,
  }
  return (
    <QueryClientProvider client={client}>
      <ConfigEditor text={text} components={[datafactory]} devices={[]} onChange={setText} />
      <output data-testid="serialized-config">{text}</output>
    </QueryClientProvider>
  )
}

describe("visual training config editor", () => {
  it("adds a catalog component as an individual metric entry", () => {
    render(<EditorHarness />)
    fireEvent.click(screen.getByRole("button", { name: "评估指标 (1)" }))
    fireEvent.click(screen.getByRole("button", { name: "添加条目" }))

    expect(screen.getByRole("heading", { name: "评估指标 2" })).toBeInTheDocument()
    const config = parse(screen.getByTestId("serialized-config").textContent ?? "") as {
      metric: { type: string }[]
    }
    expect(config.metric.map((item) => item.type)).toEqual(["mape", "mae"])
  })

  it("loads required fields from the backend schema and writes serializable defaults to YAML", async () => {
    render(<DatafactoryEditorHarness />)
    fireEvent.click(screen.getByRole("button", { name: "数据处理" }))

    expect(await screen.findByRole("spinbutton", { name: "eval_cycle_max · 必填" })).toBeInTheDocument()
    await waitFor(() => {
      const config = parse(screen.getByTestId("serialized-config").textContent ?? "") as {
        datafactory: { params: { batch_size?: number } }
      }
      expect(config.datafactory.params.batch_size).toBe(16)
    })
  })
})
