import { PlusIcon, TrashIcon } from "@primer/octicons-react"
import { Button, Checkbox, FormControl, Select, TextInput } from "@primer/react"
import { useQuery } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useState } from "react"
import { parse, stringify } from "yaml"
import { api } from "../api/client"
import type { Component } from "../api/types"
import { categories } from "../lib/format"

type Data = Record<string, unknown>
type ConfigComponent = { type?: string; name?: string; params?: Data; [key: string]: unknown }
const sections = [
  "mate",
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
]
const repeated = new Set(["metric", "others"])
const titleFor: Record<string, string> = {
  mate: "运行设置",
  task: "训练任务",
  runtime: "运行环境",
  datafactory: "数据处理",
  model: "模型",
  optimizers: "优化器",
  schedulers: "学习率调度",
  loss: "损失函数",
  metric: "评估指标",
  validate: "验证器",
  others: "其他组件",
}

function record(value: unknown): Data {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Data) : {}
}
function safeParse(text: string): Data {
  try {
    return record(parse(text))
  } catch {
    return {}
  }
}
function render(value: Data): string {
  return stringify(value, { lineWidth: 100 })
}
function componentScopes(scope: string, components: Component[]) {
  return components
    .filter((component) => component.scope === scope)
    .sort((a, b) => a.type.localeCompare(b.type))
}
function parameterDefaults(component: Component | undefined): Data {
  return defaultsFromSchema(component?.schema)
}
function defaultsFromSchema(value: unknown): Data {
  const schema = record(value)
  const parameters = Array.isArray(schema.params) ? schema.params : []
  return Object.fromEntries(
    parameters.flatMap((raw) => {
      const parameter = record(raw)
      return parameter.name &&
        parameter.has_default &&
        parameter.default_serializable !== false &&
        Object.hasOwn(parameter, "default")
        ? [[String(parameter.name), parameter.default]]
        : []
    }),
  )
}
function defaultComponent(scope: string, components: Component[]): ConfigComponent {
  const values = componentScopes(scope, components)
  const desired =
    scope === "datafactory"
      ? values.find((item) => item.type.toLowerCase() === "batterylandbatterylifedatasetfactory")
      : undefined
  const selected = desired ?? values[0]
  return {
    type: selected?.type ?? "",
    name: scope === "model" ? "model" : undefined,
    params: parameterDefaults(selected),
  }
}
function inputType(annotation: unknown, value: unknown): "number" | "boolean" | "json" | "text" {
  const hint = typeof annotation === "string" ? annotation.toLowerCase() : ""
  if (typeof value === "boolean" || hint.includes("bool")) return "boolean"
  if (typeof value === "number" || hint.includes("int") || hint.includes("float")) return "number"
  if (
    Array.isArray(value) ||
    (value !== null && typeof value === "object") ||
    hint.includes("dict") ||
    hint.includes("list")
  )
    return "json"
  return "text"
}

function FieldEditor({
  label,
  value,
  annotation,
  onChange,
}: {
  label: string
  value: unknown
  annotation?: unknown
  onChange: (value: unknown) => void
}) {
  const type = inputType(annotation, value)
  return (
    <div className="property-field">
      <div className="property-label">{label}</div>
      {type === "boolean" ? (
        <Checkbox
          aria-label={label}
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
      ) : type === "number" ? (
        <TextInput
          aria-label={label}
          type="number"
          value={value == null ? "" : String(value)}
          onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        />
      ) : type === "json" ? (
        <textarea
          className="property-json"
          aria-label={label}
          value={JSON.stringify(value ?? (Array.isArray(value) ? [] : {}), null, 2)}
          onChange={(event) => {
            try {
              onChange(JSON.parse(event.target.value))
            } catch {
              /* Keep the last valid value until JSON is complete. */
            }
          }}
        />
      ) : (
        <TextInput
          aria-label={label}
          value={value == null ? "" : String(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  )
}

export function ConfigEditor({
  text,
  components,
  devices,
  onChange,
}: {
  text: string
  components: Component[]
  devices: string[]
  onChange: (text: string) => void
}) {
  const config = useMemo(() => safeParse(text), [text])
  const [focus, setFocus] = useState("mate")
  const selected = focus.match(/^(metric|others):(\d+)$/)
  const isSelected = selected !== null
  const scope = selected?.[1] ?? focus
  const index = selected ? Number(selected[2]) : -1
  const rootValue = config[scope]
  const groupValue = selected ? (Array.isArray(rootValue) ? record(rootValue[index]) : {}) : record(rootValue)
  const currentType = String(groupValue.type ?? "")
  const choices = componentScopes(scope, components)
  const selectedEntry = choices.find((item) => item.type === currentType)
  const embeddedSchema = record(selectedEntry?.schema)
  const hasEmbeddedSchema = Array.isArray(embeddedSchema.params)
  const schemaQuery = useQuery({
    queryKey: ["component-schema", scope, currentType],
    queryFn: ({ signal }) => api.componentSchema(scope, currentType, signal),
    enabled: Boolean(currentType) && !hasEmbeddedSchema,
    staleTime: 300_000,
  })
  const selectedSchema = schemaQuery.data ?? (hasEmbeddedSchema ? embeddedSchema : undefined)
  const paramSchema = Array.isArray(selectedSchema?.params) ? (selectedSchema.params as Data[]) : []
  const patch = useCallback(
    (next: Data) => {
      onChange(render(next))
    },
    [onChange],
  )
  const setSection = useCallback(
    (section: string, value: unknown) => {
      patch({ ...config, [section]: value })
    },
    [config, patch],
  )
  const setGroup = useCallback(
    (nextGroup: ConfigComponent) => {
      if (isSelected) {
        const list = Array.isArray(rootValue) ? [...rootValue] : []
        list[index] = nextGroup
        setSection(scope, list)
      } else setSection(scope, nextGroup)
    },
    [index, isSelected, rootValue, scope, setSection],
  )
  function addGroup(section: string) {
    const current = Array.isArray(config[section]) ? [...(config[section] as unknown[])] : []
    current.push(defaultComponent(section, components))
    patch({ ...config, [section]: current })
    setFocus(`${section}:${current.length - 1}`)
  }
  function removeGroup(section: string, at: number) {
    const current = Array.isArray(config[section]) ? [...(config[section] as unknown[])] : []
    current.splice(at, 1)
    patch({ ...config, [section]: current })
    setFocus(section)
  }

  useEffect(() => {
    if (!selectedSchema || !currentType) return
    const params = record(groupValue.params)
    const defaults = defaultsFromSchema(selectedSchema)
    const missing = Object.fromEntries(
      Object.entries(defaults).filter(([name]) => !Object.hasOwn(params, name)),
    )
    if (Object.keys(missing).length) setGroup({ ...groupValue, params: { ...missing, ...params } })
  }, [currentType, groupValue, selectedSchema, setGroup])

  return (
    <div className="config-workspace">
      <nav className="config-outline" aria-label="配置条目">
        {sections.map((section) => (
          <div className="outline-section" key={section}>
            <button
              type="button"
              aria-current={focus === section ? true : undefined}
              onClick={() => setFocus(section)}
            >
              {titleFor[section]}
              {repeated.has(section)
                ? ` (${Array.isArray(config[section]) ? (config[section] as unknown[]).length : 0})`
                : ""}
            </button>
            {repeated.has(section) &&
              Array.isArray(config[section]) &&
              (config[section] as unknown[]).map((item, itemIndex) => (
                <button
                  type="button"
                  className="outline-child"
                  aria-current={focus === `${section}:${itemIndex}` ? true : undefined}
                  key={JSON.stringify(item) ?? "empty"}
                  onClick={() => setFocus(`${section}:${itemIndex}`)}
                >
                  {String(record(item).name ?? record(item).type ?? `${titleFor[section]} ${itemIndex + 1}`)}
                </button>
              ))}
          </div>
        ))}
      </nav>
      <section className="config-properties" aria-label={`${titleFor[scope] ?? scope}属性`}>
        <div className="section-title">
          <div>
            <h2>{selected ? `${titleFor[scope]} ${index + 1}` : titleFor[scope]}</h2>
            <p className="subtle">属性按组件定义展示，可在此编辑并保存为 YAML。</p>
          </div>
          {repeated.has(scope) && (
            <Button leadingVisual={PlusIcon} onClick={() => addGroup(scope)}>
              添加条目
            </Button>
          )}
        </div>
        {scope === "mate" ? (
          <div className="property-grid">
            {[
              ["seed", "随机种子"],
              ["epochs", "训练轮数"],
              ["lr", "学习率"],
              ["experiment", "运行标识"],
            ].map(([key, label]) => (
              <FieldEditor
                key={key}
                label={label}
                value={config.mate && record(config.mate)[key]}
                onChange={(value) => setSection("mate", { ...record(config.mate), [key]: value })}
              />
            ))}
            <div className="property-field">
              <label className="property-label" htmlFor="config-device">
                计算设备
              </label>
              <Select
                id="config-device"
                value={String(record(config.mate).device ?? "auto")}
                onChange={(event) =>
                  setSection("mate", { ...record(config.mate), device: event.target.value })
                }
              >
                {[
                  ...new Set(["auto", ...devices, String(record(config.mate).device ?? "")].filter(Boolean)),
                ].map((device) => (
                  <Select.Option key={device} value={device}>
                    {device === "auto" ? "自动选择" : device}
                  </Select.Option>
                ))}
              </Select>
            </div>
            <FieldEditor
              label="未展示属性（JSON）"
              value={Object.fromEntries(
                Object.entries(record(config.mate)).filter(
                  ([key]) => !["seed", "epochs", "lr", "experiment", "device"].includes(key),
                ),
              )}
              onChange={(value) => setSection("mate", { ...record(config.mate), ...record(value) })}
            />
          </div>
        ) : repeated.has(scope) && !selected ? (
          <div className="empty">
            <h3>添加{titleFor[scope]}</h3>
            <p>每条指标或扩展组件都可以单独编辑。</p>
          </div>
        ) : scope === "loss" ? (
          <ComponentBlock
            group={groupValue}
            scope={scope}
            choices={choices}
            schema={paramSchema}
            schemaPending={schemaQuery.isPending && !selectedSchema}
            schemaError={schemaQuery.error}
            onChange={setGroup}
          />
        ) : (
          <ComponentBlock
            group={groupValue}
            scope={scope}
            choices={choices}
            schema={paramSchema}
            schemaPending={schemaQuery.isPending && !selectedSchema}
            schemaError={schemaQuery.error}
            onChange={setGroup}
          />
        )}
        {selected && (
          <div className="property-actions">
            <Button variant="danger" leadingVisual={TrashIcon} onClick={() => removeGroup(scope, index)}>
              删除此条目
            </Button>
          </div>
        )}
        {scope === "mate" && (
          <div className="property-node">
            <h3>运行参数</h3>
            <p className="subtle">实验使用的配置会原样发送给后端校验；提交前可切换到 YAML 检查完整内容。</p>
          </div>
        )}
        {repeated.has(scope) && selected && (
          <p className="subtle property-hint">
            指标和扩展组件支持从组件库切换类型；参数表单随所选组件同步更新。
          </p>
        )}
      </section>
    </div>
  )
}

function ComponentBlock({
  group,
  scope,
  choices,
  schema,
  schemaPending,
  schemaError,
  onChange,
}: {
  group: ConfigComponent
  scope: string
  choices: Component[]
  schema: Data[]
  schemaPending: boolean
  schemaError: Error | null
  onChange: (group: ConfigComponent) => void
}) {
  const type = String(group.type ?? "")
  const known = choices.some((item) => item.type === type)
  const params = record(group.params)
  function setType(nextType: string) {
    const component = choices.find((item) => item.type === nextType)
    onChange({ ...group, type: nextType, params: parameterDefaults(component) })
  }
  return (
    <div className="form-stack">
      <div className="property-grid">
        <FormControl>
          <FormControl.Label>组件类别</FormControl.Label>
          <Select value={scope} disabled>
            <Select.Option value={scope}>{categories[scope] ?? scope}</Select.Option>
          </Select>
        </FormControl>
        <FormControl>
          <FormControl.Label>组件名称</FormControl.Label>
          <Select value={type} onChange={(event) => setType(event.target.value)}>
            {!known && type && <Select.Option value={type}>{type}（当前配置）</Select.Option>}
            {choices.map((item) => (
              <Select.Option value={item.type} key={item.id}>
                {item.type}
              </Select.Option>
            ))}
          </Select>
        </FormControl>
        {group.name !== undefined && (
          <FieldEditor
            label="配置名称"
            value={group.name}
            onChange={(value) => onChange({ ...group, name: String(value) })}
          />
        )}
      </div>
      {schemaPending && (
        <p className="subtle" role="status">
          正在读取组件参数定义…
        </p>
      )}
      {schemaError && (
        <p className="error-notice" role="alert">
          无法读取组件参数：{schemaError.message}。可切换到 YAML 编辑。
        </p>
      )}
      {schema.length > 0 ? (
        <div className="property-grid">
          {schema.map((raw) => {
            const name = String(raw.name ?? "")
            if (!name) return null
            return (
              <FieldEditor
                key={name}
                label={`${name}${raw.required ? " · 必填" : ""}`}
                annotation={raw.annotation}
                value={Object.hasOwn(params, name) ? params[name] : raw.default}
                onChange={(value) => onChange({ ...group, params: { ...params, [name]: value } })}
              />
            )
          })}
        </div>
      ) : (
        <p className="subtle">当前组件没有可发现的参数定义。可切换到 YAML 编辑其他配置，未知字段会保留。</p>
      )}
    </div>
  )
}
