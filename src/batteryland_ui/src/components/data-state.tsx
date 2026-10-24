import { AlertCircleIcon, InboxIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { errorMessage } from "@/api/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation()
  return (
    <Alert variant="destructive">
      <AlertCircleIcon />
      <AlertTitle>{t("common.loadingFailed")}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>{errorMessage(error)}</span>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

export function LoadingState({ rows = 3 }: { rows?: number }) {
  const { t } = useTranslation()
  return (
    <div
      className="flex flex-col gap-2"
      role="status"
      aria-busy="true"
      aria-label={t("common.loading")}
    >
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <InboxIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  )
}

export function QueryBoundary({
  loading,
  error,
  data,
  onRetry,
  children,
}: {
  loading: boolean
  error: unknown
  data: unknown
  onRetry?: () => void
  children: ReactNode
}) {
  if (loading && data === undefined) {
    return <LoadingState />
  }
  if (error) {
    return <ErrorState error={error} onRetry={onRetry} />
  }
  return <>{children}</>
}
