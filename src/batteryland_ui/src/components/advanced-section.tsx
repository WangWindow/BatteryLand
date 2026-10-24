import { ChevronDownIcon } from "lucide-react"
import { type ReactNode, useState } from "react"

export function AdvancedSection({
  label,
  children,
  className = "",
  onExpandedChange,
}: {
  label: string
  children: ReactNode
  className?: string
  onExpandedChange?: (expanded: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <details
      className={`group/advanced min-w-0 ${className}`}
      onToggle={(event) => {
        const next = event.currentTarget.open
        setExpanded(next)
        onExpandedChange?.(next)
      }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 py-2 text-sm text-muted-foreground hover:text-foreground">
        <ChevronDownIcon
          aria-hidden="true"
          className="size-4 transition-transform group-open/advanced:rotate-180"
        />
        {label}
      </summary>
      {expanded ? <div className="flex min-w-0 flex-col gap-4 pt-2">{children}</div> : null}
    </details>
  )
}
