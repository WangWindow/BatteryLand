import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import i18n from "@/i18n"

export type JsonEditorState = {
  text: string
  value: Record<string, unknown> | null
  error: string | null
}

export function parseJsonObject(text: string): JsonEditorState {
  if (!text.trim()) {
    return { text, value: {}, error: null }
  }
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { text, value: null, error: i18n.t("common.jsonInvalidObject") }
    }
    return { text, value: value as Record<string, unknown>, error: null }
  } catch (error) {
    return {
      text,
      value: null,
      error:
        error instanceof Error
          ? i18n.t("common.jsonInvalid", { message: error.message })
          : i18n.t("common.jsonInvalidShort"),
    }
  }
}

export function JsonEditor({
  label,
  value,
  onChange,
  description,
  rows = 14,
  disabled,
  className,
}: {
  label: string
  value: JsonEditorState
  onChange: (value: JsonEditorState) => void
  description?: string
  rows?: number
  disabled?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const id = useId()
  const [touched, setTouched] = useState(false)
  const invalid = Boolean(value.error) && touched
  return (
    <Field data-invalid={invalid} className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        rows={rows}
        spellCheck={false}
        disabled={disabled}
        aria-invalid={invalid}
        className="font-mono text-xs leading-relaxed"
        value={value.text}
        onChange={(event) => {
          setTouched(true)
          onChange(parseJsonObject(event.target.value))
        }}
        onBlur={() => setTouched(true)}
      />
      {invalid ? (
        <FieldError>{value.error}</FieldError>
      ) : description ? (
        <FieldDescription>{description}</FieldDescription>
      ) : (
        <FieldDescription className="sr-only">{t("common.optional")}</FieldDescription>
      )}
    </Field>
  )
}
