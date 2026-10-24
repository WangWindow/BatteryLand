import { BarChart3Icon, DownloadIcon, PlusIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react"
import { lazy, Suspense, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { errorMessage } from "@/api/client"
import { endpoints } from "@/api/endpoints"
import type { Category, ComparisonData, Experiment, SetRef, Split } from "@/api/models"
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state"
import { LazyBoundary } from "@/components/lazy-boundary"
import { PageHeader } from "@/components/page-header"
import { PaginationControls } from "@/components/pagination-controls"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
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
import { useApiQuery } from "@/hooks/use-api-query"
import { enumLabel, formatMetric } from "@/lib/format"

const Visualizer = lazy(() => import("@/visualizer"))

const CHART_TYPES = [
  { value: "metric_bar", labelKey: "compare.chartTypes.metricBar", group: "experiments" },
  { value: "epoch_line", labelKey: "compare.chartTypes.epochLine", group: "experiments" },
  {
    value: "prediction_scatter",
    labelKey: "compare.chartTypes.predictionScatter",
    group: "experiments",
  },
  { value: "set_count_bar", labelKey: "compare.chartTypes.setCountBar", group: "sets" },
  { value: "overlap_bar", labelKey: "compare.chartTypes.overlapBar", group: "sets" },
  { value: "category_bar", labelKey: "compare.chartTypes.categoryBar", group: "sets" },
] as const

type ChartType = (typeof CHART_TYPES)[number]["value"]
type Partition = "train" | "val" | "test"

type SetDraft = {
  key: string
  label: string
  splitId: string
  partitions: Partition[]
}

const CATEGORIES: { value: Category; labelKey: string }[] = [
  { value: "chemistry", labelKey: "compare.categories.chemistry" },
  { value: "material", labelKey: "compare.categories.material" },
  { value: "temperature_c", labelKey: "compare.categories.temperature_c" },
  { value: "source", labelKey: "compare.categories.source" },
]

export function ComparisonPage() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [draftQuery, setDraftQuery] = useState("")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string[]>([])
  const [metricPage, setMetricPage] = useState(1)
  const [predictionPage, setPredictionPage] = useState(1)

  const [chartType, setChartType] = useState<ChartType>("metric_bar")
  const [metric, setMetric] = useState("")
  const [stage, setStage] = useState<"train" | "validation" | "test">("test")
  const [category, setCategory] = useState<Category>("chemistry")
  const [sets, setSets] = useState<SetDraft[]>([
    {
      key: "set-1",
      label: t("compare.defaultSet", { index: 1 }),
      splitId: "",
      partitions: ["train"],
    },
  ])
  const [chartRequest, setChartRequest] = useState<{
    chart_type: ChartType
    experiment_ids?: string[]
    sets?: SetRef[]
    metric?: string
    stage?: "train" | "validation" | "test"
    category?: string
  } | null>(null)

  const experiments = useApiQuery(
    (signal) =>
      endpoints.experiments.list(
        {
          page,
          pageSize,
          q: query || undefined,
          state: "succeeded",
        },
        signal,
      ),
    [page, pageSize, query],
  )
  const splits = useApiQuery(
    (signal) => endpoints.splits.list({ page: 1, pageSize: 200 }, signal),
    [],
  )
  const key = selected.join(",")
  const comparison = useApiQuery(
    (signal) =>
      selected.length > 0
        ? endpoints.analysis.compare({ experiment_ids: selected }, signal)
        : Promise.resolve(null),
    [key],
    { enabled: selected.length > 0 },
  )
  const charts = useApiQuery(
    (signal) =>
      chartRequest ? endpoints.analysis.charts(chartRequest, signal) : Promise.resolve(null),
    [chartRequest],
    { enabled: Boolean(chartRequest) },
  )

  const metricNames = useMemo(
    () => [...new Set((comparison.data?.metric_rows ?? []).map((row) => row.name))].sort(),
    [comparison.data],
  )
  const metricRows = comparison.data?.metric_rows ?? []
  const predictionRows = comparison.data?.prediction_rows ?? []
  const visibleMetrics = metricRows.slice((metricPage - 1) * 50, metricPage * 50)
  const visiblePredictions = predictionRows.slice((predictionPage - 1) * 50, predictionPage * 50)

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    )
    setMetricPage(1)
    setPredictionPage(1)
    setChartRequest(null)
  }

  function updateSet(key: string, patch: Partial<SetDraft>) {
    setSets((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)))
    setChartRequest(null)
  }

  function resolvedSets(): SetRef[] | string {
    if (sets.length === 0) {
      return t("compare.messages.addSetRequired")
    }
    const result: SetRef[] = []
    for (const item of sets) {
      const split = splits.data?.items.find((value) => value.id === item.splitId)
      if (!item.label.trim()) {
        return t("compare.messages.setLabelRequired")
      }
      if (!split || !item.splitId) {
        return t("compare.messages.setSplitRequired")
      }
      if (item.partitions.length === 0) {
        return t("compare.messages.setPartitionRequired")
      }
      result.push({
        label: item.label.trim(),
        split: { id: split.id, version: split.version },
        partitions: item.partitions,
      })
    }
    return result
  }

  function buildChart() {
    const definition = CHART_TYPES.find((item) => item.value === chartType)
    if (!definition) {
      return
    }
    if (definition.group === "experiments") {
      if (selected.length === 0) {
        toast.error(t("compare.messages.selectExperiments"))
        return
      }
      if (chartType !== "prediction_scatter" && (!metric.trim() || !stage)) {
        toast.error(t("compare.messages.selectMetric"))
        return
      }
      setChartRequest({
        chart_type: chartType,
        experiment_ids: selected,
        ...(chartType === "prediction_scatter" ? {} : { metric: metric.trim(), stage }),
      })
      return
    }
    const value = resolvedSets()
    if (typeof value === "string") {
      toast.error(value)
      return
    }
    setChartRequest({
      chart_type: chartType,
      sets: value,
      ...(chartType === "category_bar" ? { category } : {}),
    })
  }

  async function exportComparison(format: "json" | "csv") {
    if (selected.length === 0) {
      return
    }
    try {
      await endpoints.analysis.export({ experiment_ids: selected, format })
      toast.success(t("common.exportStarted"))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <>
      <PageHeader
        title={t("compare.title")}
        description={t("compare.description")}
        actions={
          <>
            <Button
              variant="outline"
              disabled={selected.length === 0}
              onClick={() => void exportComparison("json")}
            >
              <DownloadIcon data-icon="inline-start" />
              {t("compare.exportJson")}
            </Button>
            <Button
              variant="outline"
              disabled={selected.length === 0}
              onClick={() => void exportComparison("csv")}
            >
              <DownloadIcon data-icon="inline-start" />
              {t("compare.exportCsv")}
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("compare.selectTitle")}</CardTitle>
          <CardDescription>
            {t("compare.selectDescription", { count: selected.length })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              setPage(1)
              setQuery(draftQuery)
            }}
          >
            <Field className="w-64">
              <FieldLabel htmlFor="compare-q">{t("compare.nameFilter")}</FieldLabel>
              <Input
                id="compare-q"
                value={draftQuery}
                onChange={(event) => setDraftQuery(event.target.value)}
              />
            </Field>
            <Button type="submit" variant="outline">
              <SearchIcon data-icon="inline-start" />
              {t("compare.search")}
            </Button>
          </form>
          {selected.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {selected.map((identity) => {
                const experiment = experiments.data?.items.find((item) => item.id === identity)
                return (
                  <Badge key={identity} variant="secondary" className="gap-1">
                    {experiment?.name ?? identity.slice(0, 8)}
                    <button
                      type="button"
                      aria-label={t("compare.removeExperiment")}
                      className="rounded-full hover:bg-muted"
                      onClick={() => toggle(identity)}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </Badge>
                )
              })}
            </div>
          ) : null}
          {experiments.loading && experiments.data === undefined ? <LoadingState rows={3} /> : null}
          {experiments.error ? (
            <ErrorState error={experiments.error} onRetry={experiments.refresh} />
          ) : null}
          {experiments.data && experiments.data.items.length === 0 ? (
            <EmptyState
              title={t("compare.emptyExperimentsTitle")}
              description={t("compare.emptyExperimentsDescription")}
            />
          ) : null}
          {experiments.data && experiments.data.items.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>{t("compare.columns.experiment")}</TableHead>
                    <TableHead>{t("compare.columns.device")}</TableHead>
                    <TableHead>{t("compare.columns.collection")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {experiments.data.items.map((experiment: Experiment) => (
                    <TableRow key={experiment.id}>
                      <TableCell>
                        <Checkbox
                          aria-label={t("compare.selectExperiment", { name: experiment.name })}
                          checked={selected.includes(experiment.id)}
                          onCheckedChange={() => toggle(experiment.id)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{experiment.name}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {experiment.effective_device ?? experiment.requested_device ?? "—"}
                      </TableCell>
                      <TableCell>{enumLabel(experiment.collection.status, "collection")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <PaginationControls
                page={page}
                pageSize={pageSize}
                total={experiments.data.total}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size)
                  setPage(1)
                }}
              />
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>{t("compare.dataTitle")}</CardTitle>
            <CardDescription>{t("compare.dataDescription")}</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={comparison.refresh}
            disabled={selected.length === 0}
          >
            {t("compare.refresh")}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {selected.length === 0 ? (
            <EmptyState
              title={t("compare.noSelectionTitle")}
              description={t("compare.noSelectionDescription")}
            />
          ) : null}
          {comparison.loading && comparison.data === undefined ? <LoadingState rows={4} /> : null}
          {comparison.error ? (
            <ErrorState error={comparison.error} onRetry={comparison.refresh} />
          ) : null}
          {comparison.data ? (
            <ComparisonTables
              data={comparison.data}
              metricPage={metricPage}
              predictionPage={predictionPage}
              onMetricPage={setMetricPage}
              onPredictionPage={setPredictionPage}
              visibleMetrics={visibleMetrics}
              visiblePredictions={visiblePredictions}
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("compare.chartTitle")}</CardTitle>
          <CardDescription>{t("compare.chartDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field>
                <FieldLabel htmlFor="chart-type">{t("compare.chartType")}</FieldLabel>
                <Select
                  value={chartType}
                  onValueChange={(value: ChartType) => {
                    setChartType(value)
                    setChartRequest(null)
                  }}
                >
                  <SelectTrigger id="chart-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {CHART_TYPES.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {t(item.labelKey)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              {CHART_TYPES.find((item) => item.value === chartType)?.group === "experiments" ? (
                chartType !== "prediction_scatter" ? (
                  <>
                    <Field>
                      <FieldLabel htmlFor="chart-metric">{t("compare.metric")}</FieldLabel>
                      <Input
                        id="chart-metric"
                        list="metric-options"
                        value={metric}
                        placeholder={metricNames[0] ?? t("compare.metricPlaceholder")}
                        onChange={(event) => {
                          setMetric(event.target.value)
                          setChartRequest(null)
                        }}
                      />
                      <datalist id="metric-options">
                        {metricNames.map((name) => (
                          <option key={name} value={name} />
                        ))}
                      </datalist>
                      <FieldDescription>{t("compare.metricHint")}</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="chart-stage">{t("compare.stage")}</FieldLabel>
                      <Select
                        value={stage}
                        onValueChange={(value: "train" | "validation" | "test") => {
                          setStage(value)
                          setChartRequest(null)
                        }}
                      >
                        <SelectTrigger id="chart-stage">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="train">{t("common.stages.train")}</SelectItem>
                            <SelectItem value="validation">
                              {t("common.stages.validation")}
                            </SelectItem>
                            <SelectItem value="test">{t("common.stages.test")}</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  </>
                ) : (
                  <p className="self-end text-sm text-muted-foreground sm:col-span-2">
                    {t("compare.scatterHint")}
                  </p>
                )
              ) : (
                <Field>
                  <FieldLabel htmlFor="chart-category">{t("compare.category")}</FieldLabel>
                  <Select
                    value={category}
                    onValueChange={(value: Category) => {
                      setCategory(value)
                      setChartRequest(null)
                    }}
                  >
                    <SelectTrigger id="chart-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {CATEGORIES.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {t(item.labelKey)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </div>

            {CHART_TYPES.find((item) => item.value === chartType)?.group === "sets" ? (
              <div className="flex flex-col gap-3 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{t("compare.setTitle")}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSets((current) => [
                        ...current,
                        {
                          key: `set-${current.length + 1}`,
                          label: t("compare.defaultSet", { index: current.length + 1 }),
                          splitId: "",
                          partitions: ["train"],
                        },
                      ])
                      setChartRequest(null)
                    }}
                  >
                    <PlusIcon data-icon="inline-start" />
                    {t("compare.addSet")}
                  </Button>
                </div>
                {sets.map((item) => (
                  <div key={item.key} className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor={`set-label-${item.key}`}>
                        {t("compare.label")}
                      </FieldLabel>
                      <Input
                        id={`set-label-${item.key}`}
                        value={item.label}
                        onChange={(event) => updateSet(item.key, { label: event.target.value })}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`set-split-${item.key}`}>
                        {t("compare.split")}
                      </FieldLabel>
                      <Select
                        value={item.splitId || "none"}
                        onValueChange={(value) =>
                          updateSet(item.key, { splitId: value === "none" ? "" : value })
                        }
                      >
                        <SelectTrigger id={`set-split-${item.key}`}>
                          <SelectValue placeholder={t("compare.chooseSplit")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="none">{t("compare.chooseSplit")}</SelectItem>
                            {(splits.data?.items ?? []).map((split: Split) => (
                              <SelectItem key={split.id} value={split.id}>
                                {t("common.versionedName", {
                                  name: split.name,
                                  version: split.version,
                                })}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field className="sm:col-span-2">
                      <FieldLabel>{t("compare.partitions")}</FieldLabel>
                      <div className="flex flex-wrap gap-4">
                        {(["train", "val", "test"] as const).map((partition) => (
                          // biome-ignore lint/a11y/noLabelWithoutControl: Radix checkbox renders role=checkbox
                          <label key={partition} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              aria-label={t("compare.partitionCheckbox", {
                                set: item.label,
                                partition,
                              })}
                              checked={item.partitions.includes(partition)}
                              onCheckedChange={(checked) =>
                                updateSet(item.key, {
                                  partitions: checked
                                    ? [...item.partitions, partition]
                                    : item.partitions.filter((value) => value !== partition),
                                })
                              }
                            />
                            {partition}
                          </label>
                        ))}
                      </div>
                    </Field>
                    <div className="flex justify-end sm:col-span-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={sets.length === 1}
                        onClick={() => {
                          setSets((current) => current.filter((value) => value.key !== item.key))
                          setChartRequest(null)
                        }}
                      >
                        <Trash2Icon data-icon="inline-start" />
                        {t("compare.removeSet")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <div>
              <Button onClick={buildChart} disabled={selected.length === 0}>
                <BarChart3Icon data-icon="inline-start" />
                {t("compare.generate")}
              </Button>
            </div>
          </FieldGroup>

          {charts.loading ? <LoadingState rows={4} /> : null}
          {charts.error ? <ErrorState error={charts.error} onRetry={charts.refresh} /> : null}
          {charts.data ? (
            <div className="flex flex-col gap-3">
              {charts.data.warnings.length > 0 ? (
                <Alert>
                  <AlertTitle>{t("compare.chartNotes")}</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-5">
                      {charts.data.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}
              <LazyBoundary>
                <Suspense fallback={<LoadingState rows={4} />}>
                  <Visualizer bundle={charts.data} />
                </Suspense>
              </LazyBoundary>
            </div>
          ) : !charts.loading ? (
            <EmptyState
              title={t("compare.notGeneratedTitle")}
              description={t("compare.notGeneratedDescription")}
            />
          ) : null}
        </CardContent>
      </Card>
    </>
  )
}

function ComparisonTables({
  data,
  metricPage,
  predictionPage,
  onMetricPage,
  onPredictionPage,
  visibleMetrics,
  visiblePredictions,
}: {
  data: ComparisonData
  metricPage: number
  predictionPage: number
  onMetricPage: (page: number) => void
  onPredictionPage: (page: number) => void
  visibleMetrics: ComparisonData["metric_rows"]
  visiblePredictions: ComparisonData["prediction_rows"]
}) {
  const { t } = useTranslation()
  return (
    <>
      {data.warnings.length > 0 ? (
        <Alert>
          <AlertTitle>{t("compare.comparisonWarnings")}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {data.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">
          {t("compare.metricRows", { count: data.metric_rows.length })}
        </h3>
        {data.metric_rows.length === 0 ? (
          <EmptyState title={t("compare.noMetricData")} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("compare.columns.experiment")}</TableHead>
                    <TableHead>{t("compare.columns.stage")}</TableHead>
                    <TableHead>{t("compare.columns.metric")}</TableHead>
                    <TableHead>{t("compare.columns.epoch")}</TableHead>
                    <TableHead>{t("compare.columns.value")}</TableHead>
                    <TableHead>{t("compare.columns.unit")}</TableHead>
                    <TableHead>{t("compare.columns.granularity")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleMetrics.map((row, index) => (
                    <TableRow key={`${row.experiment_id}-${row.name}-${row.epoch}-${index}`}>
                      <TableCell className="font-mono text-xs">
                        {row.experiment_id.slice(0, 8)}
                      </TableCell>
                      <TableCell>{enumLabel(row.stage, "stages")}</TableCell>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>{row.epoch ?? "—"}</TableCell>
                      <TableCell>{formatMetric(row.value, row.unit)}</TableCell>
                      <TableCell>{row.unit}</TableCell>
                      <TableCell>{row.granularity}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {data.metric_rows.length > 50 ? (
              <PaginationControls
                page={metricPage}
                pageSize={50}
                total={data.metric_rows.length}
                onPageChange={onMetricPage}
              />
            ) : null}
          </>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">
          {t("compare.predictionRows", { count: data.prediction_rows.length })}
        </h3>
        {data.prediction_rows.length === 0 ? (
          <EmptyState title={t("compare.noPredictionData")} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("compare.columns.experiment")}</TableHead>
                    <TableHead>{t("compare.columns.battery")}</TableHead>
                    <TableHead>{t("compare.columns.prediction")}</TableHead>
                    <TableHead>{t("compare.columns.target")}</TableHead>
                    <TableHead>{t("compare.columns.granularity")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiblePredictions.map((row, index) => (
                    <TableRow key={`${row.experiment_id}-${row.battery_id}-${index}`}>
                      <TableCell className="font-mono text-xs">
                        {row.experiment_id.slice(0, 8)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.battery_id}</TableCell>
                      <TableCell>{formatMetric(row.prediction)}</TableCell>
                      <TableCell>
                        {row.target === null ? (
                          <span className="text-muted-foreground">
                            {t("compare.noGroundTruth")}
                          </span>
                        ) : (
                          formatMetric(row.target)
                        )}
                      </TableCell>
                      <TableCell>{row.granularity}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {data.prediction_rows.length > 50 ? (
              <PaginationControls
                page={predictionPage}
                pageSize={50}
                total={data.prediction_rows.length}
                onPageChange={onPredictionPage}
              />
            ) : null}
          </>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{t("compare.sources")}</h3>
        {data.sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("compare.noSources")}</p>
        ) : (
          <ul className="font-mono text-xs text-muted-foreground">
            {data.sources.map((source) => (
              <li key={`${source.experiment_id}-${source.result_version}`}>
                {t("compare.sourceLine", {
                  experiment: source.experiment_id.slice(0, 8),
                  version: source.result_version,
                  artifact: source.source_artifact_id.slice(0, 8),
                })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
