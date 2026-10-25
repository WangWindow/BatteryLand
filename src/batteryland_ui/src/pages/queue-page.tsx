import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CpuIcon, MemoryStickIcon, RefreshCwIcon, StopCircleIcon } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { toast } from "sonner"

import { errorMessage } from "@/api/client"
import { endpoints } from "@/api/endpoints"
import type { ExperimentSummary, ResourceNode } from "@/api/models"
import { queryKeys } from "@/api/query-client"
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state"
import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatBytes, formatDate, shortId } from "@/lib/format"

export function QueuePage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [stopTarget, setStopTarget] = useState<ExperimentSummary | null>(null)
  const queueQuery = useQuery({
    queryKey: queryKeys.queue,
    queryFn: ({ signal }) => endpoints.scheduler.queue(signal),
    refetchInterval: 2_000,
  })
  const resourceQuery = useQuery({
    queryKey: queryKeys.resources,
    queryFn: ({ signal }) => endpoints.scheduler.resources(signal),
    refetchInterval: 15_000,
  })
  const statusQuery = useQuery({
    queryKey: ["scheduler", "status"],
    queryFn: ({ signal }) => endpoints.scheduler.status(signal),
    refetchInterval: 5_000,
  })
  const stopMutation = useMutation({
    mutationFn: (id: string) => endpoints.experiments.stop(id),
    onSuccess: async (experiment) => {
      setStopTarget(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.queue }),
        queryClient.invalidateQueries({ queryKey: ["experiments"] }),
      ])
      toast.success(t("workflow.monitor.stopRequested", { name: experiment.name }))
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const queue = queueQuery.data
  const resources = resourceQuery.data ?? []
  const schedulerStatus = statusQuery.data

  return (
    <>
      <PageHeader
        title={t("workflow.monitor.title")}
        description={t("workflow.monitor.description")}
        actions={
          <Button
            variant="outline"
            onClick={() => {
              void queueQuery.refetch()
              void resourceQuery.refetch()
            }}
          >
            <RefreshCwIcon data-icon="inline-start" />
            {t("common.refresh")}
          </Button>
        }
      />
      {queueQuery.isLoading && !queue ? <LoadingState rows={4} /> : null}
      {queueQuery.error ? (
        <ErrorState error={queueQuery.error} onRetry={() => void queueQuery.refetch()} />
      ) : null}
      {queue?.dispatch_paused ? (
        <Alert variant="destructive">
          <AlertTitle>{t("workflow.monitor.schedulerPaused")}</AlertTitle>
          <AlertDescription>{queue.reason}</AlertDescription>
        </Alert>
      ) : null}
      {schedulerStatus &&
      typeof schedulerStatus === "object" &&
      "enabled" in schedulerStatus &&
      !schedulerStatus.enabled ? (
        <Alert>
          <AlertTitle>{t("workflow.monitor.schedulerDisabled")}</AlertTitle>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-3" aria-labelledby="resource-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="resource-heading" className="font-semibold">
            {t("workflow.monitor.resources")}
          </h2>
          {resources[0] ? (
            <span className="text-xs text-muted-foreground">
              {t("workflow.monitor.lastSeen", { time: formatDate(resources[0].last_seen_at) })}
            </span>
          ) : null}
        </div>
        {resourceQuery.error ? (
          <ErrorState error={resourceQuery.error} onRetry={() => void resourceQuery.refetch()} />
        ) : null}
        {resources.length === 0 && !resourceQuery.isLoading ? (
          <EmptyState
            title={t("workflow.monitor.noGpu")}
            description={t("workflow.monitor.resourceMissingReason")}
          />
        ) : null}
        {resources.length === 0 && resourceQuery.isLoading ? <LoadingState rows={2} /> : null}
        {resources.length > 0 ? (
          <div className="grid gap-3 xl:grid-cols-3">
            {resources.map((node) => (
              <ResourceCard key={node.id} node={node} />
            ))}
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <QueueSection
          title={t("workflow.monitor.waiting", { count: queue?.waiting.length ?? 0 })}
          experiments={queue?.waiting ?? []}
          emptyTitle={t("workflow.monitor.emptyQueue")}
          actionLabel={t("workflow.monitor.cancel")}
          onStop={setStopTarget}
        />
        <QueueSection
          title={t("workflow.monitor.active", { count: queue?.active.length ?? 0 })}
          experiments={queue?.active ?? []}
          emptyTitle={t("workflow.monitor.emptyActive")}
          actionLabel={t("workflow.monitor.stop")}
          onStop={setStopTarget}
        />
      </div>

      <AlertDialog
        open={Boolean(stopTarget)}
        onOpenChange={(open) => {
          if (!open) setStopTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("workflow.monitor.stopConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>{stopTarget?.name}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (stopTarget) stopMutation.mutate(stopTarget.id)
              }}
              disabled={stopMutation.isPending}
            >
              <StopCircleIcon data-icon="inline-start" />
              {t("workflow.monitor.stop")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ResourceCard({ node }: { node: ResourceNode }) {
  const { t } = useTranslation()
  const resources = node.resources
  const memoryPercent =
    resources.memory_total && resources.memory_available != null
      ? Math.max(0, Math.min(100, 100 * (1 - resources.memory_available / resources.memory_total)))
      : 0
  const gpus = resources.gpus ?? []
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="font-mono">{node.id}</span>
          <Badge variant="outline">
            {t("workflow.monitor.lastSeen", { time: formatDate(node.last_seen_at) })}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CpuIcon aria-hidden="true" />
              {t("workflow.monitor.cpu")}
            </div>
            <div className="mt-2 text-lg font-semibold tabular-nums">
              {resources.cpu_percent == null ? "—" : `${resources.cpu_percent.toFixed(0)}%`}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MemoryStickIcon aria-hidden="true" />
              {t("workflow.monitor.memory")}
            </div>
            <div className="mt-2 text-lg font-semibold tabular-nums">
              {formatBytes(resources.memory_available)}
            </div>
            <progress
              max={100}
              value={memoryPercent}
              aria-label={t("workflow.monitor.memory")}
              className="mt-2 h-2 w-full accent-primary"
            />
          </div>
        </div>
        {gpus.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {gpus.map((gpu) => (
              <li key={gpu.uuid} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-mono">{`cuda:${gpu.cuda_index}`}</span>
                  <span className="text-muted-foreground">{gpu.uuid}</span>
                </div>
                <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {t("workflow.monitor.gpuMemory")}: {formatBytes(gpu.free_bytes)} /{" "}
                    {formatBytes(gpu.total_bytes)}
                  </span>
                  <span>
                    {t("workflow.monitor.gpuUtilization")}:{" "}
                    {gpu.utilization_percent == null
                      ? "—"
                      : `${gpu.utilization_percent.toFixed(0)}%`}
                  </span>
                </div>
                <progress
                  max={100}
                  value={gpu.utilization_percent ?? 0}
                  aria-label={t("workflow.monitor.gpuUtilization")}
                  className="mt-2 h-2 w-full accent-primary"
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {resources.reason ?? t("workflow.monitor.noGpu")}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function QueueSection({
  title,
  experiments,
  emptyTitle,
  actionLabel,
  onStop,
}: {
  title: string
  experiments: ExperimentSummary[]
  emptyTitle: string
  actionLabel: string
  onStop: (experiment: ExperimentSummary) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {experiments.length === 0 ? <EmptyState title={emptyTitle} /> : null}
        {experiments.map((experiment, index) => (
          <div
            key={experiment.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs text-muted-foreground">
                {index + 1}
              </span>
              <div className="min-w-0">
                <Link
                  to={`/experiments/${experiment.id}`}
                  className="block truncate font-medium hover:text-primary"
                >
                  {experiment.name}
                </Link>
                <span className="block font-mono text-xs text-muted-foreground">
                  {shortId(experiment.id)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge state={experiment.state} />
              <Badge variant="outline" className="font-mono">
                {experiment.actual_device ??
                  experiment.effective_device ??
                  experiment.requested_device ??
                  "—"}
              </Badge>
              <Button size="sm" variant="outline" onClick={() => onStop(experiment)}>
                <StopCircleIcon data-icon="inline-start" />
                {actionLabel}
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
