import { json } from "@codemirror/lang-json"
import { yaml } from "@codemirror/lang-yaml"
import { useTheme } from "@primer/react"
import { githubDark, githubLight } from "@uiw/codemirror-theme-github"
import CodeMirror from "@uiw/react-codemirror"
import { useMemo } from "react"

export type CodeLanguage = "json" | "text" | "yaml"

export function CodeEditor({
  value,
  language = "text",
  readOnly = false,
  onChange,
  minHeight,
  height,
  ariaLabel,
}: {
  value: string
  language?: CodeLanguage
  readOnly?: boolean
  onChange?: (value: string) => void
  minHeight?: string
  height?: string
  ariaLabel: string
}) {
  const { colorMode } = useTheme()
  const extensions = useMemo(() => {
    if (language === "yaml") return [yaml()]
    if (language === "json") return [json()]
    return []
  }, [language])
  const displayValue = useMemo(() => {
    if (language !== "json") return value
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }, [language, value])

  return (
    <div className={`code-editor ${readOnly ? "is-readonly" : ""}`}>
      <CodeMirror
        aria-label={ariaLabel}
        basicSetup={{ lineNumbers: true, highlightActiveLine: !readOnly }}
        editable={!readOnly}
        extensions={extensions}
        height={height}
        maxHeight={height}
        minHeight={minHeight}
        onChange={onChange}
        readOnly={readOnly}
        theme={colorMode === "night" || colorMode === "dark" ? githubDark : githubLight}
        value={displayValue}
      />
    </div>
  )
}
