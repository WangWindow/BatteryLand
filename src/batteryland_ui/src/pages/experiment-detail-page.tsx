import {
  ArrowLeftIcon,
  CopyIcon,
  DownloadIcon,
  FileTextIcon,
  FlaskConicalIcon,
  RefreshCwIcon,
  StopCircleIcon,
  Trash2Icon,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"
import { errorMessage } from "@/api/client"
import { endpoints } from "@/api/endpoints"
import type { Artifact, Metric, Prediction } from "@/api/models"
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state"
import { PageHeader } from "@/components/page-header"
import { PaginationControls } from "@/components/pagination-controls"
import { StatusBadge } from "@/components/status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useApiQuery } from "@/hooks/use-api-query"
import { useLogPolling } from "@/hooks/use-log-polling"
import { enumLabel, formatBytes, formatDate, formatMetric, shortId } from "@/lib/format"

const ACTIVE_STATES = new Set(["starting", "running", "stopping", "needs_reconciliation"])
const STOPPABLE_STATES = new Set(["queued", "starting", "running"])

export function ExperimentDetailPage() {
  const { t } = useTranslation()
  const { experimentId = "" } = useParams()
  const [tab, setTab] = useState("overview")
  const [logStream, setLogStream] = useState<"train" | "console">("train")
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [metricPage, setMetricPage] = useState(1)
  const [predictionPage, setPredictionPage] = useState(1)
  const logRef = useRef<HTMLPreElement | null>(null)

  const experiment = useApiQuery(
    (signal) => endpoints.experiments.get(experimentId, signal),
    [experimentId],
    { pollMs: 2000 },
  )
  const state = experiment.data?.state
  const active = state ? ACTIVE_STATES.has(state) : false
  const results = useApiQuery(
    (signal) => endpoints.results.get(experimentId, signal),
    [experimentId],
    { pollMs: active ? 5000 : undefined },
  )
  const artifacts = useApiQuery(
    (signal) => endpoints.results.artifacts(experimentId, signal),
    [experimentId],
    { pollMs: active ? 5000 : undefined },
  )
  const logs = useLogPolling(experimentId, logStream, tab === "logs" && Boolean(experimentId))

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs.text])

  async function action(operation: () => Promise<unknown>, success: string) {
    setPending(true)
    try {
      await operation()
      toast.success(success)
      experiment.refresh()
      results.refresh()
      artifacts.refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  if (experiment.loading && experiment.data === undefined) {
    return <LoadingState rows={8} />
  }
  if (experiment.error) {
    return (
      <>
        <PageHeader title={t("detail.pageTitle")} />
        <ErrorState error={experiment.error} onRetry={experiment.refresh} />
        <Button asChild variant="outline">
          <Link to="/experiments">
            <ArrowLeftIcon data-icon="inline-start" />
            {t("detail.backToList")}
          </Link>
        </Button>
      </>
    )
  }
  if (!experiment.data) {
    return <EmptyState title={t("detail.notFound")} />
  }
  const value = experiment.data
  const metrics = results.data?.metrics ?? []
  const predictions = results.data?.predictions ?? []
  const metricPages = Math.max(1, Math.ceil(metrics.length / 50))
  const predictionPages = Math.max(1, Math.ceil(predictions.length / 50))
  const visibleMetrics = metrics.slice((metricPage - 1) * 50, metricPage * 50)
  const visiblePredictions = predictions.slice((predictionPage - 1) * 50, predictionPage * 50)

  return (
    <>
      <PageHeader
        title={value.name}
        description={t("detail.description", { id: value.id })}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/experiments">
                <ArrowLeftIcon data-icon="inline-start" />
                {t("detail.back")}
              </Link>
            </Button>
            <Button variant="outline" onClick={experiment.refresh}>
              <RefreshCwIcon data-icon="inline-start" />
              {t("detail.refresh")}
            </Button>
            {value.state === "draft" ? (
              <Button
                onClick={() =>
                  void action(
                    () => endpoints.experiments.queue([value.id]),
                    t("detail.queuedMessage"),
                  )
                }
                disabled={pending}
              >
                <FlaskConicalIcon data-icon="inline-start" />
                {t("detail.submitQueue")}
              </Button>
            ) : null}
            {STOPPABLE_STATES.has(value.state) ? (
              <Button
                variant="destructive"
                onClick={() =>
                  void action(() => endpoints.experiments.stop(value.id), t("detail.stopAccepted"))
                }
                disabled={pending}
              >
                <StopCircleIcon data-icon="inline-start" />
                {t("detail.requestStop")}
              </Button>
            ) : null}
          </>
        }
      />

      {value.state === "needs_reconciliation" ? (
        <Alert variant="destructive">
          <AlertTitle>{t("detail.reconcileTitle")}</AlertTitle>
          <AlertDescription>{t("detail.reconcileDescription")}</AlertDescription>
        </Alert>
      ) : null}
      {value.collection.status !== "pending" || value.collection.error ? (
        <Alert variant={value.collection.error ? "destructive" : "default"}>
          <AlertTitle>
            {t("detail.collectionTitle", {
              status: enumLabel(value.collection.status, "collection"),
            })}
          </AlertTitle>
          {value.collection.error ? (
            <AlertDescription>{value.collection.error}</AlertDescription>
          ) : null}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge state={value.state} />
        <Badge variant="outline">{enumLabel(value.kind, "kinds")}</Badge>
        <Badge variant="outline" className="font-mono">
          {t("detail.requestedDevice", { device: value.requested_device ?? "—" })}
        </Badge>
        {value.effective_device ? (
          <Badge variant="outline" className="font-mono">
            {t("detail.effectiveDevice", { device: value.effective_device })}
          </Badge>
        ) : null}
        <Badge variant="outline">{t("detail.revision", { revision: value.revision })}</Badge>
        <Badge variant="outline">{t("detail.version", { version: value.version ?? "—" })}</Badge>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">{t("detail.tabs.overview")}</TabsTrigger>
          <TabsTrigger value="logs">{t("detail.tabs.logs")}</TabsTrigger>
          <TabsTrigger value="results">{t("detail.tabs.results")}</TabsTrigger>
          <TabsTrigger value="artifacts">{t("detail.tabs.artifacts")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t("detail.overview.executionTitle")}</CardTitle>
                <CardDescription>{t("detail.overview.executionDescription")}</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  {[
                    [t("detail.overview.queuedAt"), formatDate(value.execution?.queued_at)],
                    [t("detail.overview.startedAt"), formatDate(value.execution?.started_at)],
                    [t("detail.overview.finishedAt"), formatDate(value.execution?.finished_at)],
                    [
                      t("detail.overview.stopRequestedAt"),
                      formatDate(value.execution?.stop_requested_at),
                    ],
                    [t("detail.overview.stopStage"), value.execution?.stop_stage ?? "—"],
                    [t("detail.overview.exitCode"), value.execution?.exit_code ?? "—"],
                  ].map(([label, content]) => (
                    <div key={label} className="flex flex-col gap-0.5">
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd>{content}</dd>
                    </div>
                  ))}
                </dl>
                {value.execution?.error ? (
                  <pre className="mt-3 overflow-auto rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                    {JSON.stringify(value.execution.error, null, 2)}
                  </pre>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("detail.overview.bindingsTitle")}</CardTitle>
                <CardDescription>{t("detail.overview.bindingsDescription")}</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  {[
                    [t("detail.overview.split"), value.bindings?.split],
                    [t("detail.overview.sourceSplit"), value.bindings?.source_split],
                    [t("detail.overview.targetSplit"), value.bindings?.target_split],
                    [t("detail.overview.template"), value.bindings?.template],
                  ].map(([label, reference]) => (
                    <div key={String(label)} className="flex flex-col gap-0.5">
                      <dt className="text-xs text-muted-foreground">{String(label)}</dt>
                      <dd className="font-mono text-xs">
                        {reference && typeof reference === "object" && "id" in reference
                          ? `${shortId(String((reference as { id: string }).id))} · v${String((reference as { version: number }).version)}`
                          : "—"}
                      </dd>
                    </div>
                  ))}
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">
                      {t("detail.overview.checkpoint")}
                    </dt>
                    <dd className="font-mono text-xs">
                      {value.bindings?.checkpoint_id ? shortId(value.bindings.checkpoint_id) : "—"}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t("detail.overview.draftActions")}</CardTitle>
              <CardDescription>{t("detail.overview.draftDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  void action(async () => {
                    const validation = await endpoints.experiments.validate(value.id)
                    if (!validation.valid) {
                      throw new Error(
                        validation.errors[0]?.message?.toString() ?? t("detail.overview.validate"),
                      )
                    }
                  }, t("detail.overview.validate"))
                }
                disabled={pending}
              >
                {t("detail.overview.validate")}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void action(async () => {
                    const copied = await endpoints.experiments.copy(value.id)
                    toast.success(t("detail.overview.copied", { name: copied.name }))
                  }, t("detail.overview.copyComplete"))
                }
                disabled={pending || active}
              >
                <CopyIcon data-icon="inline-start" />
                {t("detail.overview.copy")}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void endpoints.experiments
                    .export(value.id)
                    .then(() => toast.success(t("common.exportStarted")))
                    .catch((error: unknown) => toast.error(errorMessage(error)))
                }
              >
                <DownloadIcon data-icon="inline-start" />
                {t("detail.overview.export")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
                disabled={pending || active}
              >
                <Trash2Icon data-icon="inline-start" />
                {t("detail.overview.delete")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <CardTitle>{t("detail.logs.title")}</CardTitle>
                <CardDescription>{t("detail.logs.description")}</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant={logStream === "train" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setLogStream("train")}
                >
                  {t("detail.logs.train")}
                </Button>
                <Button
                  variant={logStream === "console" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setLogStream("console")}
                >
                  {t("detail.logs.console")}
                </Button>
                <StatusBadge state={logs.state === "unknown" ? null : logs.state} />
                {logs.eof ? <Badge variant="outline">{t("detail.logs.eof")}</Badge> : null}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {logs.resetNotice ? (
                <Alert>
                  <FileTextIcon />
                  <AlertTitle>{t("detail.logs.cursorResetTitle")}</AlertTitle>
                  <AlertDescription>{t("detail.logs.cursorResetDescription")}</AlertDescription>
                </Alert>
              ) : null}
              {logs.error ? (
                <Alert variant="destructive">
                  <AlertTitle>{t("detail.logs.readFailedTitle")}</AlertTitle>
                  <AlertDescription>{logs.error}</AlertDescription>
                </Alert>
              ) : null}
              {logs.text ? (
                <pre
                  ref={logRef}
                  aria-live="polite"
                  className="max-h-[28rem] overflow-auto rounded-md border bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-100"
                >
                  {logs.text}
                </pre>
              ) : (
                <EmptyState
                  title={t("detail.logs.emptyTitle")}
                  description={t("detail.logs.emptyDescription")}
                />
              )}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t("detail.logs.limit")}</span>
                <Button variant="outline" size="sm" onClick={logs.retry}>
                  {t("detail.logs.reconnect")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="results">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <CardTitle>{t("detail.results.title")}</CardTitle>
                <CardDescription>{t("detail.results.description")}</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={results.refresh}>
                <RefreshCwIcon data-icon="inline-start" />
                {t("detail.refresh")}
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {results.loading && results.data === undefined ? <LoadingState rows={4} /> : null}
              {results.error ? (
                <ErrorState error={results.error} onRetry={results.refresh} />
              ) : null}
              {results.data && !results.data.available ? (
                <EmptyState
                  title={t("detail.results.unavailableTitle")}
                  description={results.data.reason ?? t("detail.results.unavailableReason")}
                />
              ) : null}
              {results.data?.available ? (
                <>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <Badge variant="outline">
                      {t("detail.results.version", { version: results.data.version ?? "—" })}
                    </Badge>
                    <Badge variant="outline">
                      {t("detail.results.bestEpoch", { epoch: results.data.best_epoch ?? "—" })}
                    </Badge>
                    <Badge variant="outline">
                      {t("detail.results.summary", {
                        metrics: results.data.metrics.length,
                        predictions: results.data.predictions.length,
                      })}
                    </Badge>
                  </div>
                  {results.data.warnings.length > 0 ? (
                    <Alert>
                      <AlertTitle>{t("detail.results.warningsTitle")}</AlertTitle>
                      <AlertDescription>
                        <ul className="list-disc pl-5">
                          {results.data.warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <div className="grid gap-6 xl:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <h3 className="text-sm font-medium">{t("detail.results.metrics")}</h3>
                      {metrics.length === 0 ? (
                        <EmptyState title={t("detail.results.noMetrics")} />
                      ) : (
                        <>
                          <div className="overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>{t("detail.results.columns.stage")}</TableHead>
                                  <TableHead>{t("detail.results.columns.name")}</TableHead>
                                  <TableHead>{t("detail.results.columns.epoch")}</TableHead>
                                  <TableHead>{t("detail.results.columns.value")}</TableHead>
                                  <TableHead>{t("detail.results.columns.unit")}</TableHead>
                                  <TableHead>{t("detail.results.columns.granularity")}</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {visibleMetrics.map((metric: Metric, index) => (
                                  <TableRow
                                    key={`${metric.stage}-${metric.name}-${metric.epoch}-${index}`}
                                  >
                                    <TableCell>{enumLabel(metric.stage, "stages")}</TableCell>
                                    <TableCell className="font-medium">{metric.name}</TableCell>
                                    <TableCell>{metric.epoch ?? "—"}</TableCell>
                                    <TableCell>{formatMetric(metric.value, metric.unit)}</TableCell>
                                    <TableCell>{metric.unit}</TableCell>
                                    <TableCell>{metric.granularity}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                          {metricPages > 1 ? (
                            <PaginationControls
                              page={metricPage}
                              pageSize={50}
                              total={metrics.length}
                              onPageChange={setMetricPage}
                            />
                          ) : null}
                        </>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      <h3 className="text-sm font-medium">{t("detail.results.predictions")}</h3>
                      {predictions.length === 0 ? (
                        <EmptyState title={t("detail.results.noPredictions")} />
                      ) : (
                        <>
                          <div className="overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>{t("detail.results.columns.battery")}</TableHead>
                                  <TableHead>{t("detail.results.columns.prediction")}</TableHead>
                                  <TableHead>{t("detail.results.columns.target")}</TableHead>
                                  <TableHead>{t("detail.results.columns.granularity")}</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {visiblePredictions.map((prediction: Prediction) => (
                                  <TableRow
                                    key={`${prediction.battery_id}-${prediction.granularity}`}
                                  >
                                    <TableCell className="max-w-48 truncate font-mono text-xs">
                                      {prediction.file_name}
                                    </TableCell>
                                    <TableCell>{formatMetric(prediction.prediction)}</TableCell>
                                    <TableCell>
                                      {prediction.target === null ? (
                                        <span className="text-muted-foreground">
                                          {t("detail.results.noGroundTruth")}
                                        </span>
                                      ) : (
                                        formatMetric(prediction.target)
                                      )}
                                    </TableCell>
                                    <TableCell>{prediction.granularity}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                          {predictionPages > 1 ? (
                            <PaginationControls
                              page={predictionPage}
                              pageSize={50}
                              total={predictions.length}
                              onPageChange={setPredictionPage}
                            />
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <h3 className="text-sm font-medium">{t("detail.results.sources")}</h3>
                    {results.data.sources.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {t("detail.results.noSources")}
                      </p>
                    ) : (
                      <ul className="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
                        {results.data.sources.map((source) => (
                          <li key={`${source.experiment_id}-${source.result_version}`}>
                            {t("detail.results.sourceLine", {
                              version: source.result_version,
                              artifact: shortId(source.source_artifact_id),
                              hash: shortId(source.source_hash),
                            })}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="artifacts">
          <Card>
            <CardHeader>
              <CardTitle>{t("detail.artifacts.title")}</CardTitle>
              <CardDescription>{t("detail.artifacts.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              {artifacts.loading && artifacts.data === undefined ? <LoadingState rows={3} /> : null}
              {artifacts.error ? (
                <ErrorState error={artifacts.error} onRetry={artifacts.refresh} />
              ) : null}
              {artifacts.data && artifacts.data.length === 0 ? (
                <EmptyState title={t("detail.artifacts.empty")} />
              ) : null}
              {artifacts.data && artifacts.data.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("detail.artifacts.columns.name")}</TableHead>
                      <TableHead>{t("detail.artifacts.columns.kind")}</TableHead>
                      <TableHead>{t("detail.artifacts.columns.size")}</TableHead>
                      <TableHead>{t("detail.artifacts.columns.availability")}</TableHead>
                      <TableHead>{t("detail.artifacts.columns.createdAt")}</TableHead>
                      <TableHead className="text-right">
                        {t("detail.artifacts.columns.actions")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {artifacts.data.map((artifact: Artifact) => (
                      <TableRow key={artifact.id}>
                        <TableCell className="max-w-64 truncate font-mono text-xs">
                          {artifact.name}
                        </TableCell>
                        <TableCell>{enumLabel(artifact.kind, "artifactKinds")}</TableCell>
                        <TableCell>{formatBytes(artifact.size)}</TableCell>
                        <TableCell>{enumLabel(artifact.availability, "availability")}</TableCell>
                        <TableCell>{formatDate(artifact.created_at)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={artifact.is_directory}
                            onClick={() =>
                              endpoints.results
                                .download(artifact.id)
                                .then(() => toast.success(t("common.downloadStarted")))
                                .catch((error: unknown) => toast.error(errorMessage(error)))
                            }
                          >
                            <DownloadIcon data-icon="inline-start" />
                            {artifact.is_directory
                              ? t("detail.artifacts.directory")
                              : t("detail.artifacts.download")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("detail.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("detail.deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                void action(async () => {
                  await endpoints.experiments.remove(value.id)
                  setDeleteOpen(false)
                  window.location.assign("/experiments")
                }, t("detail.deleted"))
              }
            >
              {t("common.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
