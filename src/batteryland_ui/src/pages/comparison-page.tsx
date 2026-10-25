import { useQuery } from "@tanstack/react-query"
import { DownloadIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react"
import { lazy, Suspense, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { errorMessage } from "@/api/client"
import { endpoints } from "@/api/endpoints"
import type { ExperimentSummary, Schema } from "@/api/models"
import { queryKeys } from "@/api/query-client"
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state"
import { PageHeader } from "@/components/page-header"
import { PaginationControls } from "@/components/pagination-controls"
import { StatusBadge } from "@/components/status-badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatDate, formatMetric } from "@/lib/format"

const Visualizer = lazy(() => import("@/visualizer"))
const CHART_TYPES = [
  ["metric_bar", "compare.chartTypes.metricBar", "experiments"],
  ["epoch_line", "compare.chartTypes.epochLine", "experiments"],
  ["prediction_scatter", "compare.chartTypes.predictionScatter", "experiments"],
  ["set_count_bar", "compare.chartTypes.setCountBar", "sets"],
  ["overlap_bar", "compare.chartTypes.overlapBar", "sets"],
  ["category_bar", "compare.chartTypes.categoryBar", "sets"],
] as const
type ChartType = (typeof CHART_TYPES)[number][0]
type ExperimentChartType = Extract<ChartType, "metric_bar" | "epoch_line" | "prediction_scatter">
type DatasetChartType = Extract<ChartType, "set_count_bar" | "overlap_bar" | "category_bar">
type Category = "source" | "chemistry" | "material" | "temperature_c"
type Partition = "train" | "val" | "test"
type SetDraft = { key: string; label: string; reference: string; partitions: Partition[] }

const PARTITIONS: Partition[] = ["train", "val", "test"]
const CATEGORIES: { value: Category; labelKey: string }[] = [
  { value: "chemistry", labelKey: "compare.categories.chemistry" },
  { value: "material", labelKey: "compare.categories.material" },
  { value: "temperature_c", labelKey: "compare.categories.temperature_c" },
  { value: "source", labelKey: "compare.categories.source" },
]

export function ComparisonPage() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [searchDraft, setSearchDraft] = useState("")
  const [search, setSearch] = useState("")
  const [selectedExperiments, setSelectedExperiments] = useState<string[]>([])
  const [chartType, setChartType] = useState<ExperimentChartType>("metric_bar")
  const [datasetChartType, setDatasetChartType] = useState<DatasetChartType>("set_count_bar")
  const [metric, setMetric] = useState("")
  const [stage, setStage] = useState<"train" | "validation" | "test">("test")
  const [category, setCategory] = useState<Category>("chemistry")
  const [metricPage, setMetricPage] = useState(1)
  const [predictionPage, setPredictionPage] = useState(1)
  const [chartRequest, setChartRequest] = useState<Schema["ChartRequest"] | null>(null)
  const [sets, setSets] = useState<SetDraft[]>([
    {
      key: "set-1",
      label: t("compare.defaultSet", { index: 1 }),
      reference: "",
      partitions: ["train"],
    },
    {
      key: "set-2",
      label: t("compare.defaultSet", { index: 2 }),
      reference: "",
      partitions: ["test"],
    },
  ])

  const experimentsQuery = useQuery({
    queryKey: queryKeys.experiments({ page, pageSize, search, state: "succeeded" }),
    queryFn: ({ signal }) =>
      endpoints.experiments.list(
        { page, pageSize, q: search || undefined, state: "succeeded" },
        signal,
      ),
  })
  const splitsQuery = useQuery({
    queryKey: queryKeys.splits({ page: 1, pageSize: 200 }),
    queryFn: ({ signal }) => endpoints.splits.list({ page: 1, pageSize: 200 }, signal),
  })
  const groupsQuery = useQuery({
    queryKey: queryKeys.groups,
    queryFn: ({ signal }) => endpoints.groups.list({ page: 1, pageSize: 200 }, signal),
  })
  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources,
    queryFn: ({ signal }) => endpoints.sources.list({ page: 1, pageSize: 200 }, signal),
  })

  const selectedKey = selectedExperiments.join(",")
  const comparisonQuery = useQuery({
    queryKey: queryKeys.comparison(selectedExperiments),
    queryFn: ({ signal }) =>
      endpoints.analysis.compare({ experiment_ids: selectedExperiments }, signal),
    enabled: selectedExperiments.length > 0,
  })
  const epochMetricsQuery = useQuery({
    queryKey: ["epoch-metric-names", selectedKey],
    queryFn: async ({ signal }) => {
      const pages = await Promise.all(
        selectedExperiments.map(async (id) => {
          const first = await endpoints.results.metrics(id, { page: 1, pageSize: 200 }, signal)
          const rows = [...first.items]
          for (let next = 2; next <= Math.ceil(first.total / first.page_size); next += 1) {
            rows.push(
              ...(await endpoints.results.metrics(id, { page: next, pageSize: 200 }, signal)).items,
            )
          }
          return rows
        }),
      )
      return pages.flat()
    },
    enabled: chartType === "epoch_line" && selectedExperiments.length > 0,
  })
  const chartQuery = useQuery({
    queryKey: ["analysis-chart", chartRequest],
    queryFn: ({ signal }) =>
      endpoints.analysis.charts(chartRequest as Schema["ChartRequest"], signal),
    enabled: Boolean(chartRequest),
  })

  const metricRows = comparisonQuery.data?.metric_rows ?? []
  const predictionRows = comparisonQuery.data?.prediction_rows ?? []
  const metricNames = useMemo(() => {
    const source = chartType === "epoch_line" ? (epochMetricsQuery.data ?? []) : metricRows
    return [...new Set(source.filter((row) => row.stage === stage).map((row) => row.name))].sort()
  }, [chartType, epochMetricsQuery.data, metricRows, stage])
  const candidateItems = useMemo(
    () => [
      ...(sourcesQuery.data?.items ?? []).map((item) => ({
        value: `source:${item.id}`,
        label: item.name,
      })),
      ...(groupsQuery.data?.items ?? []).map((item) => ({
        value: `group:${item.name}`,
        label: item.name,
      })),
      ...(splitsQuery.data?.items ?? []).map((item) => ({
        value: `split:${item.id}`,
        label: `${item.name} · v${item.version}`,
      })),
    ],
    [groupsQuery.data, sourcesQuery.data, splitsQuery.data],
  )

  function toggleExperiment(id: string) {
    setSelectedExperiments((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
    setMetricPage(1)
    setPredictionPage(1)
    setChartRequest(null)
  }

  function updateSet(key: string, patch: Partial<SetDraft>) {
    setSets((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)))
    setChartRequest(null)
  }

  function buildSetReferences(): Schema["SetRef"][] | null {
    const result: Schema["SetRef"][] = []
    for (const item of sets) {
      if (!item.label.trim() || !item.reference) return null
      const [kind, ...rest] = item.reference.split(":")
      const identity = rest.join(":")
      if (kind === "source") {
        result.push({ label: item.label.trim(), source_id: identity, partitions: PARTITIONS })
      } else if (kind === "group") {
        result.push({
          label: item.label.trim(),
          named_group: identity,
          partitions: item.partitions,
        })
      } else if (kind === "split") {
        const split = splitsQuery.data?.items.find((candidate) => candidate.id === identity)
        if (!split) return null
        result.push({
          label: item.label.trim(),
          split: { id: split.id, version: split.version },
          partitions: item.partitions,
        })
      }
    }
    return result.length >= 2 ? result : null
  }

  function buildExperimentChart() {
    if (!selectedExperiments.length) {
      toast.error(t("compare.messages.selectExperiments"))
      return
    }
    if (chartType !== "prediction_scatter" && !metricNames.includes(metric) && !metricNames[0]) {
      toast.error(t("compare.messages.selectMetric"))
      return
    }
    setChartRequest({
      chart_type: chartType,
      experiment_ids: selectedExperiments,
      ...(chartType === "prediction_scatter"
        ? {}
        : { metric: metricNames.includes(metric) ? metric : metricNames[0], stage }),
    })
  }

  function buildDatasetChart() {
    const references = buildSetReferences()
    if (!references) {
      toast.error(t("compare.messages.setSplitRequired"))
      return
    }
    setChartRequest({
      chart_type: datasetChartType,
      sets: references,
      ...(datasetChartType === "category_bar" ? { category } : {}),
    })
  }

  async function exportComparison(format: "json" | "csv") {
    if (!selectedExperiments.length) return
    try {
      await endpoints.analysis.export({ experiment_ids: selectedExperiments, format })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const visibleMetrics = metricRows.slice((metricPage - 1) * 25, metricPage * 25)
  const visiblePredictions = predictionRows.slice((predictionPage - 1) * 25, predictionPage * 25)
  const experiments = experimentsQuery.data?.items ?? []

  return (
    <>
      <PageHeader
        title={t("workflow.analysis.title")}
        description={t("workflow.analysis.description")}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!selectedExperiments.length}
              onClick={() => void exportComparison("csv")}
            >
              <DownloadIcon data-icon="inline-start" />
              {t("compare.exportCsv")}
            </Button>
            <Button
              variant="outline"
              disabled={!selectedExperiments.length}
              onClick={() => void exportComparison("json")}
            >
              <DownloadIcon data-icon="inline-start" />
              {t("compare.exportJson")}
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="experiments">
        <TabsList>
          <TabsTrigger value="experiments">{t("workflow.analysis.experiments")}</TabsTrigger>
          <TabsTrigger value="datasets">{t("workflow.analysis.datasets")}</TabsTrigger>
        </TabsList>

        <TabsContent value="experiments" className="mt-4 flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("workflow.analysis.chooseExperiments")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  setSearch(searchDraft)
                  setPage(1)
                }}
              >
                <Input
                  aria-label={t("compare.nameFilter")}
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder={t("compare.nameFilter")}
                />
                <Button type="submit" variant="outline">
                  <SearchIcon data-icon="inline-start" />
                  {t("compare.search")}
                </Button>
              </form>
              {experimentsQuery.isLoading && !experimentsQuery.data ? (
                <LoadingState rows={4} />
              ) : null}
              {experimentsQuery.error ? (
                <ErrorState
                  error={experimentsQuery.error}
                  onRetry={() => void experimentsQuery.refetch()}
                />
              ) : null}
              {experimentsQuery.data && experiments.length === 0 ? (
                <EmptyState
                  title={t("compare.emptyExperimentsTitle")}
                  description={t("compare.emptyExperimentsDescription")}
                />
              ) : null}
              {experiments.length > 0 ? (
                <>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10" />
                          <TableHead>{t("compare.columns.experiment")}</TableHead>
                          <TableHead>{t("workflow.list.state")}</TableHead>
                          <TableHead>{t("compare.columns.device")}</TableHead>
                          <TableHead>{t("workflow.list.created")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {experiments.map((experiment: ExperimentSummary) => (
                          <TableRow key={experiment.id}>
                            <TableCell>
                              <Checkbox
                                aria-label={t("compare.selectExperiment", {
                                  name: experiment.name,
                                })}
                                checked={selectedExperiments.includes(experiment.id)}
                                onCheckedChange={() => toggleExperiment(experiment.id)}
                              />
                            </TableCell>
                            <TableCell className="font-medium">{experiment.name}</TableCell>
                            <TableCell>
                              <StatusBadge state={experiment.state} />
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {experiment.actual_device ??
                                experiment.effective_device ??
                                experiment.requested_device ??
                                "—"}
                            </TableCell>
                            <TableCell>{formatDate(experiment.created_at)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <PaginationControls
                    page={page}
                    pageSize={pageSize}
                    total={experimentsQuery.data?.total ?? 0}
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

          {selectedExperiments.length ? (
            <>
              {comparisonQuery.isLoading && !comparisonQuery.data ? (
                <LoadingState rows={4} />
              ) : null}
              {comparisonQuery.error ? (
                <ErrorState
                  error={comparisonQuery.error}
                  onRetry={() => void comparisonQuery.refetch()}
                />
              ) : null}
              {comparisonQuery.data ? (
                <>
                  {comparisonQuery.data.warnings.map((warning) => (
                    <Alert key={warning}>
                      <AlertDescription>{warning}</AlertDescription>
                    </Alert>
                  ))}
                  <Card>
                    <CardHeader>
                      <CardTitle>{t("compare.chartTitle")}</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                      <FieldGroup className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <Field>
                          <FieldLabel htmlFor="chart-type">{t("compare.chartType")}</FieldLabel>
                          <Select
                            value={chartType}
                            onValueChange={(value: ExperimentChartType) => {
                              setChartType(value)
                              setChartRequest(null)
                            }}
                          >
                            <SelectTrigger id="chart-type">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {CHART_TYPES.filter(([, , group]) => group === "experiments").map(
                                  ([value, label]) => (
                                    <SelectItem key={value} value={value}>
                                      {t(label)}
                                    </SelectItem>
                                  ),
                                )}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </Field>
                        {chartType === "metric_bar" || chartType === "epoch_line" ? (
                          <>
                            <Field>
                              <FieldLabel htmlFor="analysis-metric">
                                {t("workflow.analysis.metric")}
                              </FieldLabel>
                              <Select
                                value={
                                  metricNames.includes(metric) ? metric : (metricNames[0] ?? "")
                                }
                                onValueChange={(value) => {
                                  setMetric(value)
                                  setChartRequest(null)
                                }}
                              >
                                <SelectTrigger id="analysis-metric">
                                  <SelectValue placeholder={t("workflow.analysis.metric")} />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectGroup>
                                    {metricNames.map((name) => (
                                      <SelectItem key={name} value={name}>
                                        {name}
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                            </Field>
                            <Field>
                              <FieldLabel htmlFor="analysis-stage">
                                {t("workflow.analysis.stage")}
                              </FieldLabel>
                              <Select
                                value={stage}
                                onValueChange={(value: "train" | "validation" | "test") => {
                                  setStage(value)
                                  setChartRequest(null)
                                }}
                              >
                                <SelectTrigger id="analysis-stage">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectGroup>
                                    <SelectItem value="train">
                                      {t("common.stages.train")}
                                    </SelectItem>
                                    <SelectItem value="validation">
                                      {t("common.stages.validation")}
                                    </SelectItem>
                                    <SelectItem value="test">{t("common.stages.test")}</SelectItem>
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                            </Field>
                          </>
                        ) : null}
                        <Button className="self-end" onClick={buildExperimentChart}>
                          <SearchIcon data-icon="inline-start" />
                          {t("workflow.analysis.chart")}
                        </Button>
                      </FieldGroup>
                      {chartType === "prediction_scatter" ? (
                        <p className="text-sm text-muted-foreground">{t("compare.scatterHint")}</p>
                      ) : null}
                      {chartRequest ? (
                        <>
                          {chartQuery.isLoading ? <LoadingState rows={3} /> : null}
                          {chartQuery.error ? (
                            <ErrorState
                              error={chartQuery.error}
                              onRetry={() => void chartQuery.refetch()}
                            />
                          ) : null}
                          {chartQuery.data ? (
                            <Suspense fallback={<LoadingState rows={3} />}>
                              <Visualizer bundle={chartQuery.data} />
                            </Suspense>
                          ) : null}
                        </>
                      ) : (
                        <EmptyState
                          title={t("compare.notGeneratedTitle")}
                          description={t("compare.notGeneratedDescription")}
                        />
                      )}
                    </CardContent>
                  </Card>
                  <Tabs defaultValue="metrics">
                    <TabsList>
                      <TabsTrigger value="metrics">
                        {t("compare.metricRows", { count: metricRows.length })}
                      </TabsTrigger>
                      <TabsTrigger value="predictions">
                        {t("compare.predictionRows", { count: predictionRows.length })}
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="metrics" className="mt-3">
                      {metricRows.length ? (
                        <>
                          <div className="overflow-x-auto rounded-md border">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>{t("compare.columns.experiment")}</TableHead>
                                  <TableHead>{t("compare.columns.stage")}</TableHead>
                                  <TableHead>{t("compare.columns.epoch")}</TableHead>
                                  <TableHead>{t("compare.columns.metric")}</TableHead>
                                  <TableHead>{t("compare.columns.value")}</TableHead>
                                  <TableHead>{t("compare.columns.unit")}</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {visibleMetrics.map((row, index) => (
                                  <TableRow
                                    key={`${row.experiment_id}-${row.stage}-${row.name}-${row.epoch}-${index}`}
                                  >
                                    <TableCell>
                                      {experiments.find((item) => item.id === row.experiment_id)
                                        ?.name ?? row.experiment_id.slice(0, 8)}
                                    </TableCell>
                                    <TableCell>{row.stage}</TableCell>
                                    <TableCell>{row.epoch ?? "—"}</TableCell>
                                    <TableCell>{row.name}</TableCell>
                                    <TableCell className="font-mono">
                                      {formatMetric(row.value)}
                                    </TableCell>
                                    <TableCell>{row.unit}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                          <PaginationControls
                            page={metricPage}
                            pageSize={25}
                            total={metricRows.length}
                            onPageChange={setMetricPage}
                            onPageSizeChange={() => setMetricPage(1)}
                          />
                        </>
                      ) : (
                        <EmptyState title={t("compare.noMetricData")} />
                      )}
                    </TabsContent>
                    <TabsContent value="predictions" className="mt-3">
                      {predictionRows.length ? (
                        <>
                          <div className="overflow-x-auto rounded-md border">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>{t("compare.columns.experiment")}</TableHead>
                                  <TableHead>{t("compare.columns.battery")}</TableHead>
                                  <TableHead>{t("compare.columns.prediction")}</TableHead>
                                  <TableHead>{t("compare.columns.target")}</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {visiblePredictions.map((row, index) => (
                                  <TableRow key={`${row.experiment_id}-${row.battery_id}-${index}`}>
                                    <TableCell>
                                      {experiments.find((item) => item.id === row.experiment_id)
                                        ?.name ?? row.experiment_id.slice(0, 8)}
                                    </TableCell>
                                    <TableCell className="font-mono">{row.battery_id}</TableCell>
                                    <TableCell>{formatMetric(row.prediction)}</TableCell>
                                    <TableCell>
                                      {row.target == null
                                        ? t("compare.noGroundTruth")
                                        : formatMetric(row.target)}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                          <PaginationControls
                            page={predictionPage}
                            pageSize={25}
                            total={predictionRows.length}
                            onPageChange={setPredictionPage}
                            onPageSizeChange={() => setPredictionPage(1)}
                          />
                        </>
                      ) : (
                        <EmptyState title={t("compare.noPredictionData")} />
                      )}
                    </TabsContent>
                  </Tabs>
                </>
              ) : null}
            </>
          ) : (
            <EmptyState
              title={t("compare.noSelectionTitle")}
              description={t("compare.noSelectionDescription")}
            />
          )}
        </TabsContent>

        <TabsContent value="datasets" className="mt-4 flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("workflow.analysis.chooseSets")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {sets.map((item, index) => {
                const selectedKind = item.reference.split(":", 1)[0]
                const showPartitions = selectedKind === "split" || selectedKind === "group"
                return (
                  <div
                    key={item.key}
                    className="grid gap-3 rounded-md border p-3 md:grid-cols-[minmax(8rem,1fr)_minmax(12rem,2fr)_auto]"
                  >
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
                      <FieldLabel htmlFor={`set-ref-${item.key}`}>
                        {t("workflow.analysis.chooseSets")}
                      </FieldLabel>
                      <Select
                        value={item.reference || "none"}
                        onValueChange={(value) =>
                          updateSet(item.key, { reference: value === "none" ? "" : value })
                        }
                      >
                        <SelectTrigger id={`set-ref-${item.key}`}>
                          <SelectValue placeholder={t("compare.chooseSplit")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="none">{t("compare.chooseSplit")}</SelectItem>
                            {candidateItems.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    {sets.length > 2 ? (
                      <Button
                        aria-label={t("compare.removeSet")}
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          setSets((current) =>
                            current.filter((candidate) => candidate.key !== item.key),
                          )
                        }
                      >
                        <XIcon />
                      </Button>
                    ) : (
                      <div />
                    )}
                    {showPartitions ? (
                      <Field className="md:col-span-3">
                        <FieldLabel>{t("workflow.analysis.partition")}</FieldLabel>
                        <div className="flex flex-wrap gap-4">
                          {PARTITIONS.map((partition) => (
                            <div key={partition} className="flex items-center gap-2 text-sm">
                              <Checkbox
                                aria-label={t("compare.partitionCheckbox", {
                                  set: item.label || String(index + 1),
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
                              <span>
                                {t(
                                  `workflow.split.${partition === "val" ? "validation" : partition}`,
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      </Field>
                    ) : null}
                  </div>
                )
              })}
              <div className="flex flex-wrap items-end gap-3">
                <Button
                  variant="outline"
                  onClick={() =>
                    setSets((current) => [
                      ...current,
                      {
                        key: `set-${crypto.randomUUID()}`,
                        label: t("compare.defaultSet", { index: current.length + 1 }),
                        reference: "",
                        partitions: ["train"],
                      },
                    ])
                  }
                >
                  <PlusIcon data-icon="inline-start" />
                  {t("compare.addSet")}
                </Button>
                <Field className="w-full sm:w-56">
                  <FieldLabel htmlFor="dataset-chart-type">{t("compare.chartType")}</FieldLabel>
                  <Select
                    value={datasetChartType}
                    onValueChange={(value: DatasetChartType) => {
                      setDatasetChartType(value)
                      setChartRequest(null)
                    }}
                  >
                    <SelectTrigger id="dataset-chart-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {CHART_TYPES.filter(([, , group]) => group === "sets").map(
                          ([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {t(label)}
                            </SelectItem>
                          ),
                        )}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                {datasetChartType === "category_bar" ? (
                  <Field className="w-full sm:w-56">
                    <FieldLabel htmlFor="analysis-category">{t("compare.category")}</FieldLabel>
                    <Select
                      value={category}
                      onValueChange={(value: Category) => setCategory(value)}
                    >
                      <SelectTrigger id="analysis-category">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {CATEGORIES.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {t(option.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
                <Button className="sm:ml-auto" onClick={buildDatasetChart}>
                  <SearchIcon data-icon="inline-start" />
                  {t("workflow.analysis.chart")}
                </Button>
              </div>
              {chartRequest &&
              ["set_count_bar", "overlap_bar", "category_bar"].includes(chartRequest.chart_type) ? (
                <>
                  {chartQuery.isLoading ? <LoadingState rows={3} /> : null}
                  {chartQuery.error ? (
                    <ErrorState
                      error={chartQuery.error}
                      onRetry={() => void chartQuery.refetch()}
                    />
                  ) : null}
                  {chartQuery.data ? (
                    <Suspense fallback={<LoadingState rows={3} />}>
                      <Visualizer bundle={chartQuery.data} />
                    </Suspense>
                  ) : null}
                </>
              ) : (
                <EmptyState
                  title={t("compare.notGeneratedTitle")}
                  description={t("compare.notGeneratedDescription")}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  )
}
