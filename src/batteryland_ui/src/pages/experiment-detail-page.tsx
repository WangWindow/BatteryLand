import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeftIcon, DownloadIcon, PlayIcon, RefreshCwIcon, StopCircleIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { errorMessage } from "@/api/client"
import { endpoints } from "@/api/endpoints"
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useLogPolling } from "@/hooks/use-log-polling"
import { formatBytes, formatDate, formatMetric, shortId } from "@/lib/format"

const ACTIVE_STATES = new Set(["queued", "starting", "running", "stopping", "needs_reconciliation"])
type DetailTab = "overview" | "logs" | "results" | "artifacts" | "config"

export function ExperimentDetailPage() {
  const { t } = useTranslation()
  const { experimentId = "" } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const logRef = useRef<HTMLPreElement>(null)
  const [tab, setTab] = useState<DetailTab>("overview")
  const [logStream, setLogStream] = useState<"train" | "console">("train")
  const [stopOpen, setStopOpen] = useState(false)
  const experimentQuery = useQuery({
    queryKey: queryKeys.experiment(experimentId),
    queryFn: ({ signal }) => endpoints.experiments.get(experimentId, undefined, signal),
    enabled: Boolean(experimentId),
    refetchInterval: (query) => (ACTIVE_STATES.has(query.state.data?.state ?? "") ? 2_000 : false),
  })
  const active = ACTIVE_STATES.has(experimentQuery.data?.state ?? "")
  const resultQuery = useQuery({
    queryKey: queryKeys.result(experimentId),
    queryFn: ({ signal }) => endpoints.results.get(experimentId, signal),
    enabled: Boolean(experimentId),
    refetchInterval: active ? 5_000 : false,
  })
  const artifactsQuery = useQuery({
    queryKey: queryKeys.artifacts(experimentId),
    queryFn: ({ signal }) => endpoints.results.artifacts(experimentId, signal),
    enabled: Boolean(experimentId),
    refetchInterval: active ? 5_000 : false,
  })
  const logs = useLogPolling(experimentId, logStream, tab === "logs")
  const submitMutation = useMutation({
    mutationFn: () => endpoints.experiments.submit(experimentId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.experiment(experimentId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.queue }),
      ])
      toast.success(t("workflow.list.submitted", { name: experimentQuery.data?.name ?? "" }))
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const stopMutation = useMutation({
    mutationFn: () => endpoints.experiments.stop(experimentId),
    onSuccess: async () => {
      setStopOpen(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.experiment(experimentId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.queue }),
      ])
      toast.success(t("workflow.monitor.stopRequested", { name: experimentQuery.data?.name ?? "" }))
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  useEffect(() => {
    if (tab && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs.text, tab])

  if (experimentQuery.isLoading && !experimentQuery.data) return <LoadingState rows={7} />
  if (experimentQuery.error)
    return (
      <ErrorState error={experimentQuery.error} onRetry={() => void experimentQuery.refetch()} />
    )
  const experiment = experimentQuery.data
  if (!experiment) return <EmptyState title={t("detail.notFound")} />
  const currentExperiment = experiment
  const result = resultQuery.data
  const artifacts = artifactsQuery.data ?? []
  const editable = experiment.state === "draft"

  function startAgain() {
    navigate("/experiments/new", {
      state: {
        name: currentExperiment.name,
        config_text: currentExperiment.config_text,
        split_text: currentExperiment.split_text,
        sourceExperimentId: currentExperiment.id,
      },
    })
  }

  return (
    <>
      <PageHeader
        title={experiment.name}
        description={`${t("workflow.detail.title")} · ${shortId(experiment.id)}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/experiments">
                <ArrowLeftIcon data-icon="inline-start" />
                {t("workflow.list.title")}
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void experimentQuery.refetch()
                void resultQuery.refetch()
                void artifactsQuery.refetch()
              }}
            >
              <RefreshCwIcon data-icon="inline-start" />
              {t("common.refresh")}
            </Button>
            {editable ? (
              <Button variant="outline" asChild>
                <Link to={`/experiments/${experiment.id}/edit`}>{t("workflow.list.edit")}</Link>
              </Button>
            ) : (
              <Button variant="outline" onClick={startAgain}>
                <PlayIcon data-icon="inline-start" />
                {t("workflow.editor.runAgain")}
              </Button>
            )}
            {editable ? (
              <Button onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>
                <PlayIcon data-icon="inline-start" />
                {t("workflow.list.submit")}
              </Button>
            ) : null}
            {["queued", "starting", "running"].includes(experiment.state) ? (
              <Button variant="destructive" onClick={() => setStopOpen(true)}>
                <StopCircleIcon data-icon="inline-start" />
                {t("workflow.monitor.stop")}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge state={experiment.state} />
        <Badge variant="outline" className="font-mono">
          {t("workflow.editor.device")}:{" "}
          {experiment.actual_device ??
            experiment.resolved_device ??
            experiment.requested_device ??
            "—"}
        </Badge>
        <Badge variant="outline">v{experiment.version}</Badge>
        <Badge variant="outline">{formatDate(experiment.created_at)}</Badge>
      </div>

      {!experiment.receipt.execution_supported ? (
        <Alert variant="destructive">
          <AlertTitle>{t("workflow.editor.executionUnavailable")}</AlertTitle>
          <AlertDescription>{t("workflow.detail.unsupportedRun")}</AlertDescription>
        </Alert>
      ) : null}
      {experiment.state === "needs_reconciliation" ? (
        <Alert variant="destructive">
          <AlertTitle>{t("detail.reconcileTitle")}</AlertTitle>
          <AlertDescription>{t("detail.reconcileDescription")}</AlertDescription>
        </Alert>
      ) : null}
      {result?.warnings.map((warning) => (
        <Alert key={warning}>
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      ))}

      <Tabs value={tab} onValueChange={(value) => setTab(value as DetailTab)}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">{t("workflow.detail.overview")}</TabsTrigger>
          <TabsTrigger value="logs">{t("workflow.detail.logs")}</TabsTrigger>
          <TabsTrigger value="results">{t("workflow.detail.results")}</TabsTrigger>
          <TabsTrigger value="artifacts">{t("workflow.detail.artifacts")}</TabsTrigger>
          <TabsTrigger value="config">{t("workflow.detail.config")}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4 flex flex-col gap-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t("workflow.detail.execution")}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  {[
                    [t("workflow.detail.created"), experiment.created_at],
                    [t("workflow.detail.requestedDevice"), experiment.requested_device],
                    [t("workflow.detail.resolvedDevice"), experiment.resolved_device],
                    [t("workflow.detail.actualDevice"), experiment.actual_device],
                    [t("workflow.detail.provider"), experiment.provider_commit],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="mt-1 break-all font-mono text-xs">{value || "—"}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t("workflow.detail.splitSummary")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-3">
                  {(["train", "val", "test"] as const).map((partition) => (
                    <div key={partition} className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">
                        {t(`common.stages.${partition}`)}
                      </p>
                      <p className="mt-1 text-xl font-semibold tabular-nums">
                        {experiment.split_counts[partition] ?? 0}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("workflow.detail.splitName", {
                    name: String(experiment.split.dataset ?? "—"),
                  })}
                </p>
              </CardContent>
            </Card>
          </div>
          {experiment.state === "draft" ? (
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <span className="text-sm text-muted-foreground">
                  {t("workflow.detail.draftHint")}
                </span>
                <Button asChild variant="outline">
                  <Link to={`/experiments/${experiment.id}/edit`}>{t("workflow.list.edit")}</Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="logs" className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Select
              value={logStream}
              onValueChange={(value) => setLogStream(value as "train" | "console")}
            >
              <SelectTrigger className="w-48" aria-label={t("workflow.detail.logStream")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="train">{t("workflow.detail.trainLog")}</SelectItem>
                  <SelectItem value="console">{t("workflow.detail.consoleLog")}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Badge variant="outline">
              {logs.eof ? t("workflow.detail.logComplete") : logs.state}
            </Badge>
          </div>
          {logs.resetNotice ? (
            <Alert>
              <AlertDescription>{t("workflow.detail.logReset")}</AlertDescription>
            </Alert>
          ) : null}
          {logs.error ? (
            <Alert variant="destructive">
              <AlertDescription>{logs.error}</AlertDescription>
            </Alert>
          ) : null}
          <pre
            ref={logRef}
            className="max-h-[65vh] min-h-72 overflow-auto rounded-lg border bg-card p-4 font-mono text-xs leading-5 whitespace-pre-wrap"
          >
            {logs.text || t("workflow.detail.noLogs")}
          </pre>
        </TabsContent>

        <TabsContent value="results" className="mt-4 flex flex-col gap-4">
          {resultQuery.isLoading && !result ? <LoadingState rows={3} /> : null}
          {resultQuery.error ? (
            <ErrorState error={resultQuery.error} onRetry={() => void resultQuery.refetch()} />
          ) : null}
          {!result?.available ? (
            <EmptyState
              title={t("workflow.detail.noResults")}
              description={result?.reason ?? undefined}
            />
          ) : null}
          {result?.available ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{t("workflow.detail.metric")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {result.metrics.length ? (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("workflow.detail.epoch")}</TableHead>
                            <TableHead>{t("workflow.detail.stage")}</TableHead>
                            <TableHead>{t("workflow.detail.metric")}</TableHead>
                            <TableHead>{t("workflow.detail.value")}</TableHead>
                            <TableHead>{t("workflow.detail.granularity")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {result.metrics.map((metric, index) => (
                            <TableRow
                              key={`${metric.epoch}-${metric.stage}-${metric.name}-${index}`}
                            >
                              <TableCell>{metric.epoch ?? "—"}</TableCell>
                              <TableCell>{metric.stage}</TableCell>
                              <TableCell>{metric.name}</TableCell>
                              <TableCell className="font-mono">
                                {formatMetric(metric.value)}
                              </TableCell>
                              <TableCell>{metric.granularity}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <EmptyState title={t("workflow.detail.noMetrics")} />
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>{t("workflow.detail.predictions")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {result.predictions.length ? (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("workflow.detail.battery")}</TableHead>
                            <TableHead>{t("workflow.detail.prediction")}</TableHead>
                            <TableHead>{t("workflow.detail.target")}</TableHead>
                            <TableHead>{t("workflow.detail.granularity")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {result.predictions.slice(0, 500).map((prediction, index) => (
                            <TableRow key={`${prediction.battery_id}-${index}`}>
                              <TableCell>
                                <span className="font-medium">{prediction.file_name}</span>
                                <span className="block font-mono text-xs text-muted-foreground">
                                  {shortId(prediction.battery_id)}
                                </span>
                              </TableCell>
                              <TableCell className="font-mono">
                                {formatMetric(prediction.prediction)}
                              </TableCell>
                              <TableCell className="font-mono">
                                {prediction.target == null ? "—" : formatMetric(prediction.target)}
                              </TableCell>
                              <TableCell>{prediction.granularity}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <EmptyState title={t("workflow.detail.noPredictions")} />
                  )}
                </CardContent>
              </Card>
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="artifacts" className="mt-4">
          {artifactsQuery.isLoading && !artifactsQuery.data ? <LoadingState rows={3} /> : null}
          {artifactsQuery.error ? (
            <ErrorState
              error={artifactsQuery.error}
              onRetry={() => void artifactsQuery.refetch()}
            />
          ) : null}
          {artifacts.length === 0 ? <EmptyState title={t("workflow.detail.noArtifacts")} /> : null}
          {artifacts.length > 0 ? (
            <div className="flex flex-col gap-2">
              {artifacts.map((artifact) => (
                <Card key={artifact.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{artifact.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {artifact.kind} · {formatBytes(artifact.size)} · {artifact.availability}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void endpoints.results.download(artifact.id)}
                      disabled={artifact.availability !== "available"}
                    >
                      <DownloadIcon data-icon="inline-start" />
                      {t("workflow.detail.download")}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="config" className="mt-4 grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("workflow.editor.config")}</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-[65vh] overflow-auto rounded-md border bg-muted/20 p-4 font-mono text-xs leading-5 whitespace-pre-wrap">
                {experiment.config_text}
              </pre>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("workflow.detail.splitDocument")}</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-[65vh] overflow-auto rounded-md border bg-muted/20 p-4 font-mono text-xs leading-5 whitespace-pre-wrap">
                {JSON.stringify(experiment.split, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={stopOpen} onOpenChange={setStopOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("workflow.monitor.stopConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>{experiment.name}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => stopMutation.mutate()}
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
