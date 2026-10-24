import { useEffect, useId, useState } from "react"
import { useTranslation } from "react-i18next"

import { endpoints } from "@/api/endpoints"
import { AdvancedSection } from "@/components/advanced-section"
import { ChoiceField } from "@/components/choice-field"
import { JsonEditor, type JsonEditorState, parseJsonObject } from "@/components/json-editor"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useApiQuery } from "@/hooks/use-api-query"

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Copy only the edited branch, preserving unknown values and references. */
export function updateConfigField(
  config: Record<string, unknown>,
  path: string[],
  value: unknown,
): Record<string, unknown> {
  const [key, ...rest] = path
  if (!key) return config
  return {
    ...config,
    [key]: rest.length ? updateConfigField(object(config[key]), rest, value) : value,
  }
}

function NumberSetting({
  label,
  value,
  min = 0,
  step = 1,
  onChange,
}: {
  label: string
  value: unknown
  min?: number
  step?: number
  onChange: (value: number) => void
}) {
  const id = useId()
  const [draft, setDraft] = useState(typeof value === "number" ? String(value) : "")
  useEffect(() => setDraft(typeof value === "number" ? String(value) : ""), [value])
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        min={min}
        step={step}
        value={draft}
        placeholder={typeof value === "string" ? value : undefined}
        onChange={(event) => {
          const next = event.target.value
          setDraft(next)
          const number = Number(next)
          if (
            next !== "" &&
            Number.isFinite(number) &&
            number >= min &&
            (step !== 1 || Number.isInteger(number))
          )
            onChange(number)
        }}
        onBlur={() => {
          if (
            draft === "" ||
            Number(draft) < min ||
            (step === 1 && !Number.isInteger(Number(draft)))
          )
            setDraft(typeof value === "number" ? String(value) : "")
        }}
      />
    </Field>
  )
}

export function TrainingConfigEditor({
  value,
  onChange,
  rawLabel,
}: {
  value: JsonEditorState
  onChange: (state: JsonEditorState) => void
  rawLabel: string
}) {
  const { t } = useTranslation()
  const id = useId()
  const catalog = useApiQuery((signal) => endpoints.components.list("task", signal), [])
  const config = value.value ?? {}
  const mate = object(config.mate)
  const task = object(config.task)
  const currentTask = typeof task.type === "string" ? task.type : ""
  const currentDevice = typeof mate.device === "string" ? mate.device : ""
  const taskNames = [currentTask, ...(catalog.data ?? []).map((item) => item.type)].filter(
    (name, index, names) =>
      Boolean(name) &&
      names.findIndex((item) => item.toLowerCase() === name.toLowerCase()) === index,
  )
  const devices = [...new Set(["cpu", "cuda:0", currentDevice].filter(Boolean))]
  function change(path: string[], next: unknown) {
    onChange(parseJsonObject(JSON.stringify(updateConfigField(config, path, next), null, 2)))
  }
  const batch = object(object(config.datafactory).params).batch_size
  const learningRate = object(object(config.optimizers).params).lr

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <ChoiceField
          id={`${id}-task`}
          label={t("workbench.task")}
          value={currentTask}
          placeholder={t("workbench.task")}
          options={taskNames.map((name) => ({ value: name, label: name }))}
          disabled={!value.value}
          onChange={(next) => change(["task", "type"], next)}
        />
        <ChoiceField
          id={`${id}-device`}
          label={t("workbench.device")}
          value={currentDevice}
          placeholder={t("workbench.device")}
          options={devices.map((device) => ({
            value: device,
            label: device === "cpu" ? "CPU" : device,
          }))}
          disabled={!value.value}
          onChange={(next) => change(["mate", "device"], next)}
        />
        {value.value ? (
          <>
            <NumberSetting
              label={t("workbench.seed")}
              value={mate.seed}
              onChange={(next) => change(["mate", "seed"], next)}
            />
            {mate.epochs !== undefined ? (
              <NumberSetting
                label={t("workbench.epochs")}
                min={1}
                value={mate.epochs}
                onChange={(next) => change(["mate", "epochs"], next)}
              />
            ) : null}
            {batch !== undefined ? (
              <NumberSetting
                label={t("workbench.batchSize")}
                min={1}
                value={batch}
                onChange={(next) => change(["datafactory", "params", "batch_size"], next)}
              />
            ) : null}
            {learningRate !== undefined ? (
              <NumberSetting
                label={t("workbench.learningRate")}
                step={0.00001}
                value={learningRate}
                onChange={(next) => change(["optimizers", "params", "lr"], next)}
              />
            ) : null}
          </>
        ) : null}
      </div>
      {value.error ? <FieldError>{value.error}</FieldError> : null}
      <AdvancedSection label={t("workbench.advancedConfig")}>
        <JsonEditor label={rawLabel} value={value} onChange={onChange} rows={12} />
      </AdvancedSection>
    </>
  )
}
