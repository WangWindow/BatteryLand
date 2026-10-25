import { AlertIcon, ChevronLeftIcon, ChevronRightIcon } from "@primer/octicons-react"
import { Button, Dialog, Spinner } from "@primer/react"
import type { ReactNode } from "react"

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="actions">{actions}</div>
    </header>
  )
}
export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <div className="notice error" role="alert">
      <AlertIcon />
      {error instanceof Error ? error.message : String(error)}
    </div>
  )
}
export function Loading({ label = "正在加载" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <Spinner size="small" />
      {label}
    </div>
  )
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children}
    </div>
  )
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  footer,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
  footer?: ReactNode
}) {
  return (
    <Dialog title={title} onClose={onClose} width={wide ? "880px" : "640px"}>
      <Dialog.Body>
        <div className="dialog-content">{children}</div>
      </Dialog.Body>
      {footer && <Dialog.Footer>{footer}</Dialog.Footer>}
    </Dialog>
  )
}
export function Pager({
  page,
  size,
  total,
  onChange,
}: {
  page: number
  size: number
  total: number
  onChange: (page: number) => void
}) {
  const last = Math.max(1, Math.ceil(total / size))
  return (
    <div className="pager">
      <span>
        {total.toLocaleString()} 项 · 第 {page} / {last} 页
      </span>
      <div className="actions">
        <Button
          size="small"
          leadingVisual={ChevronLeftIcon}
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          上一页
        </Button>
        <Button
          size="small"
          trailingVisual={ChevronRightIcon}
          disabled={page >= last}
          onClick={() => onChange(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  )
}
export function Details({ values }: { values: Record<string, unknown> }) {
  return (
    <dl className="details-grid">
      {Object.entries(values).map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value === undefined || value === null ? "—" : String(value)}</dd>
        </div>
      ))}
    </dl>
  )
}
export const stateName: Record<string, string> = {
  draft: "待提交",
  queued: "排队中",
  starting: "启动中",
  running: "运行中",
  stopping: "正在停止",
  stopped: "已停止",
  succeeded: "已完成",
  failed: "失败",
  needs_reconciliation: "需要检查",
}
export function StateTag({ state }: { state: string }) {
  return <span className={`state state-${state}`}>{stateName[state] ?? state}</span>
}
