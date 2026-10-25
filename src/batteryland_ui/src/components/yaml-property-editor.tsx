import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { parseDocument } from "yaml"
import { endpoints } from "@/api/endpoints"
import type { Component, ResourceNode } from "@/api/models"
import { EmptyState } from "@/components/data-state"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

type PathPart = string | number
type Property = { path: PathPart[]; label: string; value: unknown; section: string }

function pathKey(path: PathPart[]): string {
  return JSON.stringify(path)
}

function pathLabel(path: PathPart[]): string {
  return path.reduce<string>((label, part) => {
    if (typeof part === "number") return `${label}[${part}]`
    return label ? `${label}.${part}` : part
  }, "")
}

function collectProperties(value: unknown, path: PathPart[] = []): Property[] {
  if (Array.isArray(value)) {
    if (value.length === 0 || value.every((item) => item === null || typeof item !== "object")) {
      return [{ path, label: pathLabel(path), value, section: String(path[0] ?? "") }]
    }
    return value.flatMap((item, index) => collectProperties(item, [...path, index]))
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value)
    if (entries.length === 0) {
      return [{ path, label: pathLabel(path), value, section: String(path[0] ?? "") }]
    }
    return entries.flatMap(([key, child]) => collectProperties(child, [...path, key]))
  }
  return path.length
    ? [{ path, label: pathLabel(path), value, section: String(path[0] ?? "") }]
    : []
}

function readPath(value: unknown, path: PathPart[]): unknown {
  return path.reduce<unknown>((current, part) => {
    if (Array.isArray(current) && typeof part === "number") return current[part]
    if (typeof current === "object" && current !== null && typeof part === "string") {
      return (current as Record<string, unknown>)[part]
    }
    return undefined
  }, value)
}

function coerceLike(value: string, current: unknown): unknown {
  if (typeof current === "number") {
    const parsed = Number(value)
    return value.trim() === "" || !Number.isFinite(parsed) ? value : parsed
  }
  if (typeof current === "boolean") return value === "true"
  return value
}

function componentScope(section: string): string | null {
  const scopes: Record<string, string> = {
    task: "task",
    runtime: "runtime",
    datafactory: "dataset",
    model: "model",
    optimizers: "optimizer",
    schedulers: "scheduler",
    loss: "loss",
    metric: "metric",
    validate: "validate",
    others: "hook",
  }
  return scopes[section] ?? null
}

export function YamlPropertyEditor({
  source,
  onSourceChange,
  components,
  resources,
}: {
  source: string
  onSourceChange: (source: string) => void
  components: Component[]
  resources: ResourceNode[]
}) {
  const { t } = useTranslation()
  const [activeSection, setActiveSection] = useState("")
  const [selectedProperty, setSelectedProperty] = useState("")
  const [numberDraft, setNumberDraft] = useState<{ key: string; value: string } | null>(null)
  const [filter, setFilter] = useState("")
  const [addingComponent, setAddingComponent] = useState(false)
  const [componentSection, setComponentSection] = useState("model")
  const [componentType, setComponentType] = useState("")

  const parsed = useMemo(() => {
    if (!source.trim()) return { value: null, document: null, error: null }
    const document = parseDocument(source, { version: "1.2" })
    const error = document.errors.length
      ? (document.errors[0]?.message ?? t("workflow.editor.parseFailed"))
      : null
    const value = error ? null : document.toJS()
    return { value, document, error }
  }, [source, t])

  const root =
    typeof parsed.value === "object" && parsed.value !== null && !Array.isArray(parsed.value)
      ? (parsed.value as Record<string, unknown>)
      : null
  const properties = useMemo(() => (root ? collectProperties(root) : []), [root])
  const sections = Object.keys(root ?? {})
  const visibleProperties = properties.filter((property) => {
    const matchesSection = !activeSection || property.section === activeSection
    const matchesSearch =
      !filter || property.label.toLocaleLowerCase().includes(filter.toLocaleLowerCase())
    return matchesSection && matchesSearch
  })
  const selected =
    visibleProperties.find((property) => pathKey(property.path) === selectedProperty) ??
    visibleProperties[0]
  const selectedValue = selected ? readPath(root, selected.path) : undefined
  const selectedScope = selected ? componentScope(String(selected.path[0] ?? "")) : null
  const isComponentType = selected?.path.at(-1) === "type" && selectedScope !== null
  const compatibleComponents = isComponentType
    ? components.filter((component) => component.scope === selectedScope)
    : []
  const selectedComponentType =
    isComponentType && typeof selectedValue === "string" ? selectedValue : ""
  const schemaQuery = useQuery({
    queryKey: ["component-schema", selectedScope, selectedComponentType],
    queryFn: ({ signal }) =>
      endpoints.components.schema(selectedScope ?? "", selectedComponentType, signal),
    enabled: Boolean(selectedScope && selectedComponentType),
  })
  const gpuOptions = [
    ...new Set(
      resources.flatMap((node) => node.resources.gpus ?? []).map((gpu) => `cuda:${gpu.cuda_index}`),
    ),
  ]
  const isDevice = selected?.path.join(".") === "mate.device"
  const stringValue = Array.isArray(selectedValue)
    ? selectedValue.map((item) => String(item ?? "")).join("\n")
    : selectedValue === null || selectedValue === undefined
      ? ""
      : String(selectedValue)

  function writeValue(path: PathPart[], value: unknown) {
    if (!parsed.document) return
    try {
      parsed.document.setIn(path, value)
      onSourceChange(parsed.document.toString())
    } catch {
      onSourceChange(source)
    }
  }

  function updateArray(value: string) {
    if (!selected) return
    const current = Array.isArray(selectedValue) ? selectedValue : []
    writeValue(
      selected.path,
      value
        .split("\n")
        .filter((item) => item.length > 0)
        .map((item) => coerceLike(item, current[0])),
    )
  }

  function addTopLevelComponent() {
    const scope = componentScope(componentSection)
    const component = components.find((item) => item.scope === scope && item.type === componentType)
    if (!parsed.document || !component || !root) return
    const currentSection = readPath(root, [componentSection])
    if (
      currentSection !== undefined &&
      componentSection !== "metric" &&
      componentSection !== "others"
    )
      return
    const value = { type: component.type, name: componentSection, params: {} }
    let selectedPath: PathPart[] = [componentSection, "type"]
    try {
      if (componentSection === "metric" || componentSection === "others") {
        const current = currentSection
        const next = Array.isArray(current) ? [...current, value] : [value]
        parsed.document.setIn([componentSection], next)
        selectedPath = [componentSection, next.length - 1, "type"]
      } else {
        parsed.document.setIn([componentSection], value)
      }
      onSourceChange(parsed.document.toString())
      setAddingComponent(false)
      setActiveSection(componentSection)
      setSelectedProperty(pathKey(selectedPath))
    } catch {
      onSourceChange(source)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={addingComponent ? "secondary" : "outline"}
            onClick={() => setAddingComponent((value) => !value)}
          >
            {t("workflow.editor.addComponent")}
          </Button>
          {sections.length > 0 ? (
            <Select
              value={activeSection || "all"}
              onValueChange={(value) => {
                setActiveSection(value === "all" ? "" : value)
                setSelectedProperty("")
              }}
            >
              <SelectTrigger className="w-52" aria-label={t("workflow.editor.sections")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">{t("workflow.editor.sections")}</SelectItem>
                  {sections.map((section) => (
                    <SelectItem key={section} value={section}>
                      {section}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : null}
        </div>
        <Input
          className="w-full sm:max-w-64"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t("workflow.editor.searchProperties")}
          aria-label={t("workflow.editor.searchProperties")}
        />
      </div>

      {addingComponent ? (
        <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-[1fr_1fr_auto]">
          <Field>
            <FieldLabel htmlFor="component-section">
              {t("workflow.editor.componentCategory")}
            </FieldLabel>
            <Select
              value={componentSection}
              onValueChange={(value) => {
                setComponentSection(value)
                setComponentType("")
              }}
            >
              <SelectTrigger id="component-section">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {[
                    "task",
                    "runtime",
                    "datafactory",
                    "model",
                    "optimizers",
                    "schedulers",
                    "loss",
                    "metric",
                    "validate",
                    "others",
                  ].map((section) => (
                    <SelectItem key={section} value={section}>
                      {section}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="component-type">{t("workflow.editor.componentType")}</FieldLabel>
            <Select
              value={componentType || "none"}
              onValueChange={(value) => setComponentType(value === "none" ? "" : value)}
            >
              <SelectTrigger id="component-type">
                <SelectValue placeholder={t("workflow.editor.chooseValue")} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="none" disabled>
                    {t("workflow.editor.chooseValue")}
                  </SelectItem>
                  {components
                    .filter((component) => component.scope === componentScope(componentSection))
                    .map((component) => (
                      <SelectItem key={component.id} value={component.type}>
                        {component.type}
                      </SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button onClick={addTopLevelComponent} disabled={!componentType}>
              {t("workflow.editor.addComponent")}
            </Button>
          </div>
        </div>
      ) : null}

      {parsed.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t("workflow.editor.parseFailed")}: {parsed.error}
        </p>
      ) : null}
      {!source.trim() ? <EmptyState title={t("workflow.editor.importFirst")} /> : null}
      {source.trim() && !parsed.error && !root ? (
        <p role="alert" className="text-sm text-destructive">
          {t("workflow.editor.objectRequired")}
        </p>
      ) : null}

      {root ? (
        <div className="grid min-h-[24rem] overflow-hidden rounded-lg border bg-card lg:grid-cols-[minmax(14rem,0.85fr)_minmax(0,2fr)]">
          <nav
            aria-label={t("workflow.editor.sections")}
            className="border-b bg-muted/20 p-3 lg:border-r lg:border-b-0"
          >
            <ul className="flex flex-col gap-1">
              {visibleProperties.map((property) => {
                const identity = pathKey(property.path)
                const active = identity === (selected ? pathKey(selected.path) : "")
                return (
                  <li key={identity}>
                    <button
                      type="button"
                      onClick={() => setSelectedProperty(identity)}
                      aria-current={active ? "true" : undefined}
                      className={`w-full rounded-md px-2.5 py-2 text-left text-sm transition-colors ${active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                    >
                      <span className="block truncate">{property.label}</span>
                      <span className="block truncate font-mono text-[0.68rem] opacity-70">
                        {Array.isArray(property.value) ? "array" : typeof property.value}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {visibleProperties.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                {t("workflow.editor.noProperties")}
              </p>
            ) : null}
          </nav>

          <section className="flex flex-col gap-4 p-4" aria-label={t("workflow.editor.properties")}>
            {selected ? (
              <>
                <div>
                  <h3 className="font-medium">{selected.label.split(".").at(-1)}</h3>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                    {selected.label}
                  </p>
                </div>
                <FieldGroup>
                  {isDevice ? (
                    <Field>
                      <FieldLabel htmlFor="config-device">{t("workflow.editor.device")}</FieldLabel>
                      <Select
                        value={String(selectedValue ?? "")}
                        onValueChange={(value) => writeValue(selected.path, value)}
                      >
                        <SelectTrigger id="config-device">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="auto">{t("workflow.editor.autoDevice")}</SelectItem>
                            {[
                              ...new Set([
                                ...gpuOptions,
                                ...(typeof selectedValue === "string" &&
                                selectedValue.startsWith("cuda:")
                                  ? [selectedValue]
                                  : []),
                              ]),
                            ].map((device) => (
                              <SelectItem key={device} value={device}>
                                {device}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  ) : isComponentType ? (
                    <Field>
                      <FieldLabel htmlFor="config-component-type">
                        {t("workflow.editor.componentType")}
                      </FieldLabel>
                      <Select
                        value={String(selectedValue ?? "")}
                        onValueChange={(value) => writeValue(selected.path, value)}
                      >
                        <SelectTrigger id="config-component-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {compatibleComponents.map((component) => (
                              <SelectItem key={component.id} value={component.type}>
                                {component.type}
                              </SelectItem>
                            ))}
                            {typeof selectedValue === "string" &&
                            !compatibleComponents.some(
                              (component) => component.type === selectedValue,
                            ) ? (
                              <SelectItem value={selectedValue}>{selectedValue}</SelectItem>
                            ) : null}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  ) : typeof selectedValue === "boolean" ? (
                    <Field className="flex-row items-center justify-between rounded-md border p-3">
                      <FieldLabel htmlFor="config-boolean">{t("workflow.editor.value")}</FieldLabel>
                      <Switch
                        id="config-boolean"
                        checked={selectedValue}
                        onCheckedChange={(value) => writeValue(selected.path, value)}
                      />
                    </Field>
                  ) : Array.isArray(selectedValue) ? (
                    <Field>
                      <FieldLabel htmlFor="config-array">{t("workflow.editor.value")}</FieldLabel>
                      <Textarea
                        id="config-array"
                        rows={5}
                        value={stringValue}
                        onChange={(event) => updateArray(event.target.value)}
                      />
                    </Field>
                  ) : typeof selectedValue === "object" && selectedValue !== null ? (
                    <Field>
                      <FieldLabel htmlFor="config-object">{t("workflow.editor.value")}</FieldLabel>
                      <Textarea
                        id="config-object"
                        rows={6}
                        value={JSON.stringify(selectedValue, null, 2)}
                        readOnly
                      />
                    </Field>
                  ) : (
                    <Field>
                      <FieldLabel htmlFor="config-value">{t("workflow.editor.value")}</FieldLabel>
                      <Input
                        id="config-value"
                        type={typeof selectedValue === "number" ? "number" : "text"}
                        value={
                          numberDraft?.key === pathKey(selected.path)
                            ? numberDraft.value
                            : stringValue
                        }
                        onChange={(event) => {
                          const value = event.target.value
                          if (typeof selectedValue === "number") {
                            const key = pathKey(selected.path)
                            setNumberDraft({ key, value })
                            if (value.trim() !== "" && Number.isFinite(Number(value))) {
                              writeValue(selected.path, Number(value))
                            }
                            return
                          }
                          writeValue(selected.path, coerceLike(value, selectedValue))
                        }}
                        onBlur={() => {
                          if (numberDraft?.key === pathKey(selected.path)) setNumberDraft(null)
                        }}
                      />
                    </Field>
                  )}
                </FieldGroup>
                {isComponentType ? (
                  <ComponentSchemaSummary
                    component={components.find(
                      (item) => item.scope === selectedScope && item.type === selectedValue,
                    )}
                    schema={schemaQuery.data}
                  />
                ) : null}
              </>
            ) : (
              <EmptyState title={t("workflow.editor.noProperties")} />
            )}
          </section>
        </div>
      ) : null}
    </div>
  )
}

function ComponentSchemaSummary({
  component,
  schema: remoteSchema,
}: {
  component: Component | undefined
  schema: Record<string, unknown> | undefined
}) {
  const { t } = useTranslation()
  if (!component?.schema) return null
  const schema = (remoteSchema ?? component.schema) as {
    properties?: Record<string, { type?: string; description?: string }>
    required?: string[]
  }
  const properties = Object.entries(schema.properties ?? {})
  if (!properties.length) return null
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        {t("workflow.market.previewSchema")}
      </p>
      <ul className="flex flex-col gap-1.5">
        {properties.slice(0, 12).map(([name, value]) => (
          <li key={name} className="flex flex-wrap items-baseline gap-2 text-xs">
            <span className="font-mono">{name}</span>
            <span className="text-muted-foreground">
              {value.type ?? ""}
              {schema.required?.includes(name) ? " · required" : ""}
            </span>
            {value.description ? (
              <span className="text-muted-foreground">{value.description}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
