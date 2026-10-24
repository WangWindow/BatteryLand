import { AlertTriangleIcon, ListOrderedIcon, RefreshCwIcon, StopCircleIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { toast } from "sonner"

import { errorMessage } from "@/api/client"
import { endpoints } from "@/api/endpoints"
import type { Experiment } from "@/api/models"
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state"
import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useApiQuery } from "@/hooks/use-api-query"
import { enumLabel, formatDate, shortId } from "@/lib/format"

export function QueuePage() {
  const { t } = useTranslation()
  const queue = useApiQuery((signal) => endpoints.queue.get(signal), [], { pollMs: 2000 })

  async function stop(experiment: Experiment) {
    try {
      const updated = await endpoints.experiments.stop(experiment.id)
      toast.success(t("queue.messages.stopAccepted", { state: enumLabel(updated.state, "state") }))
      queue.refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <>
      <PageHeader
        title={t("queue.title")}
        actions={
          <Button variant="outline" onClick={queue.refresh}>
            <RefreshCwIcon data-icon="inline-start" />
            {t("common.refresh")}
          </Button>
        }
      />

      {queue.data?.dispatch_paused ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>{t("queue.pauseTitle")}</AlertTitle>
          <AlertDescription>
            {queue.data.reason ?? t("queue.pauseDefaultReason")}
            {t("queue.pauseDescription")}
          </AlertDescription>
        </Alert>
      ) : null}

      {queue.loading && queue.data === undefined ? <LoadingState rows={3} /> : null}
      {queue.error ? <ErrorState error={queue.error} onRetry={queue.refresh} /> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListOrderedIcon aria-hidden="true" className="size-4" />
              {t("queue.waitingTitle", { count: queue.data?.waiting.length ?? 0 })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {queue.data && queue.data.waiting.length === 0 ? (
              <EmptyState
                title={t("queue.emptyWaiting")}
                description={t("queue.emptyWaitingDescription")}
              />
            ) : null}
            {queue.data && queue.data.waiting.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("queue.columns.order")}</TableHead>
                    <TableHead>{t("queue.columns.experiment")}</TableHead>
                    <TableHead>{t("queue.columns.device")}</TableHead>
                    <TableHead>{t("queue.columns.queuedAt")}</TableHead>
                    <TableHead className="text-right">{t("queue.columns.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.data.waiting.map((experiment, index) => (
                    <TableRow key={experiment.id}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell>
                        <Link
                          to={`/experiments/${experiment.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {experiment.name}
                        </Link>
                        <span className="block font-mono text-xs text-muted-foreground">
                          {shortId(experiment.id)}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {experiment.requested_device ?? "—"}
                      </TableCell>
                      <TableCell>{formatDate(experiment.execution?.queued_at)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => void stop(experiment)}>
                          <StopCircleIcon data-icon="inline-start" />
                          {t("queue.cancelQueued")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {t("queue.activeTitle", { count: queue.data?.active.length ?? 0 })}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {queue.data && queue.data.active.length === 0 ? (
              <EmptyState
                title={t("queue.emptyActive")}
                description={t("queue.emptyActiveDescription")}
              />
            ) : null}
            {queue.data?.active.map((experiment) => (
              <div key={experiment.id} className="flex flex-col gap-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    to={`/experiments/${experiment.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {experiment.name}
                  </Link>
                  <StatusBadge state={experiment.state} />
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>
                    <dt className="inline">{t("queue.labels.device")}</dt>
                    <dd className="inline font-mono">
                      {experiment.effective_device ?? experiment.requested_device ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">{t("queue.labels.started")}</dt>
                    <dd className="inline">{formatDate(experiment.execution?.started_at)}</dd>
                  </div>
                  <div>
                    <dt className="inline">{t("queue.labels.stopRequested")}</dt>
                    <dd className="inline">
                      {formatDate(experiment.execution?.stop_requested_at)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">{t("queue.labels.stage")}</dt>
                    <dd className="inline">{experiment.execution?.stop_stage ?? "—"}</dd>
                  </div>
                </dl>
                {experiment.state !== "stopping" ? (
                  <div>
                    <Button variant="destructive" size="sm" onClick={() => void stop(experiment)}>
                      <StopCircleIcon data-icon="inline-start" />
                      {t("queue.requestStop")}
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-warning">{t("queue.stopping")}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
