import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DownloadIcon,
  FileUpIcon,
  LayersIcon,
  PlusIcon,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { endpoints } from "@/api/endpoints"
import type { Split, SplitPreviewResponse, SplitWrite } from "@/api/models"
import { queryKeys } from "@/api/query-client"
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state"
import { PageHeader } from "@/components/page-header"
import { PaginationControls } from "@/components/pagination-controls"
import { Badge } from "@/components/ui/badge"
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
import { shortId } from "@/lib/format"

type Partition = "train" | "val" | "test"
type PartitionMethod = "random" | "manual"
type PendingSelection = {
  source_id: string
  source_revision: number
  battery_ids: string[]
  battery_files: Record<string, { file_name: string; relative_key: string }>
  include_all_source: boolean
}

const PARTITIONS: Partition[] = ["train", "val", "test"]
const PARTITION_KEYS: Record<Partition, string> = {
  train: "workflow.split.train",
  val: "workflow.split.validation",
  test: "workflow.split.test",
}
const SELECTION_KEY = "batteryland.pending-split-selection"

function readSelection(): PendingSelection | null {
  try {
    const raw = sessionStorage.getItem(SELECTION_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<PendingSelection>
    if (!value.source_id || !Array.isArray(value.battery_ids)) return null
    return {
      source_id: value.source_id,
      source_revision: value.source_revision ?? 0,
      battery_ids: value.battery_ids,
      battery_files:
        value.battery_files && !Array.isArray(value.battery_files) ? value.battery_files : {},
      include_all_source: value.include_all_source ?? false,
    }
  } catch {
    return null
  }
}

function splitCounts(split: Split): Record<Partition, number> {
  return {
    train: split.counts.train ?? 0,
    val: split.counts.val ?? 0,
    test: split.counts.test ?? 0,
  }
}

function fingerprint(body: SplitWrite): string {
  return JSON.stringify(body)
}

export function SplitsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selection] = useState(readSelection)
  const [creating, setCreating] = useState(searchParams.get("create") === "1" || Boolean(selection))
  const [step, setStep] = useState(0)
  const [name, setName] = useState("")
  const [method, setMethod] = useState<PartitionMethod>(
    selection?.include_all_source ? "random" : "random",
  )
  const [ratios, setRatios] = useState({ train: "70", val: "15", test: "15" })
  const [seed, setSeed] = useState("42")
  const [assignmentPage, setAssignmentPage] = useState(1)
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [assignments, setAssignments] = useState<Record<string, Partition>>(() =>
    Object.fromEntries((readSelection()?.battery_ids ?? []).map((id) => [id, "train"])),
  )
  const [preview, setPreview] = useState<{
    fingerprint: string
    value: SplitPreviewResponse
  } | null>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [query, setQuery] = useState("")
  const [draftQuery, setDraftQuery] = useState("")
  const [sourceFilter, setSourceFilter] = useState("")

  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources,
    queryFn: ({ signal }) => endpoints.sources.list({ page: 1, pageSize: 200 }, signal),
  })
  const splitsQuery = useQuery({
    queryKey: queryKeys.splits({ page, pageSize, query, sourceFilter }),
    queryFn: ({ signal }) =>
      endpoints.splits.list(
        { page, pageSize, q: query, sourceId: sourceFilter || undefined },
        signal,
      ),
    enabled: !creating,
  })
  const sources = sourcesQuery.data?.items ?? []
  const source = sources.find((item) => item.id === selection?.source_id)
  const rows = useMemo(
    () =>
      Object.entries(selection?.battery_files ?? {}).sort(([, left], [, right]) =>
        left.relative_key.localeCompare(right.relative_key),
      ),
    [selection],
  )
  const visibleAssignments = rows.slice((assignmentPage - 1) * 50, assignmentPage * 50)

  useEffect(() => {
    if (!selection || name || !source) return
    setName(source.name)
  }, [name, selection, source])

  const body = useMemo<SplitWrite | null>(() => {
    if (!selection || !name.trim()) return null
    const selectedIds = selection.include_all_source ? [] : selection.battery_ids
    const ratioValues = {
      train: Number(ratios.train) / 100,
      val: Number(ratios.val) / 100,
      test: Number(ratios.test) / 100,
    }
    const partitions = Object.fromEntries(
      PARTITIONS.map((partition) => [
        partition,
        selectedIds.filter((id) => assignments[id] === partition),
      ]),
    ) as Record<Partition, string[]>
    return {
      name: name.trim(),
      source_id: selection.source_id,
      battery_ids: selectedIds,
      include_all_source: selection.include_all_source,
      expected_source_revision: selection.source_revision,
      method,
      ...(method === "random" ? { ratios: ratioValues, seed: Number(seed) } : { partitions }),
    }
  }, [selection, name, ratios, assignments, method, seed])
  const currentFingerprint = body ? fingerprint(body) : ""

  const previewMutation = useMutation({
    mutationFn: (payload: SplitWrite) => endpoints.splits.preview(payload),
    onSuccess: (value, payload) => {
      setPreview({ fingerprint: fingerprint(payload), value })
      setStep(2)
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t("common.loadingFailed")),
  })
  const createMutation = useMutation({
    mutationFn: (payload: SplitWrite) => endpoints.splits.create(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["splits"] })
      sessionStorage.removeItem(SELECTION_KEY)
      toast.success(t("workflow.split.saved"))
      setCreating(false)
      setSearchParams({}, { replace: true })
      setPreview(null)
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t("common.loadingFailed")),
  })
  const importMutation = useMutation({
    mutationFn: ({ sourceId, file }: { sourceId: string; file: File }) =>
      endpoints.splits.import(sourceId, file),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["splits"] })
      setImportFile(null)
      if (importInput.current) importInput.current.value = ""
      toast.success(t("workflow.split.saved"))
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t("common.loadingFailed")),
  })

  function updateRatio(partition: Partition, value: string) {
    setRatios((current) => ({ ...current, [partition]: value }))
    setPreview(null)
  }

  function changeAssignment(id: string, partition: Partition) {
    setAssignments((current) => ({ ...current, [id]: partition }))
    setPreview(null)
  }

  function assignSelected(partition: Partition) {
    setAssignments((current) => {
      const next = { ...current }
      for (const id of selectedRows) next[id] = partition
      return next
    })
    setSelectedRows(new Set())
    setPreview(null)
  }

  function setPageRows(checked: boolean) {
    setSelectedRows((current) => {
      const next = new Set(current)
      for (const [id] of visibleAssignments) {
        if (checked) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  function openCreate() {
    setCreating(true)
    setStep(0)
    setSearchParams({ create: "1" })
  }

  function closeCreate() {
    setCreating(false)
    setSearchParams({}, { replace: true })
    setPreview(null)
  }

  function previewSplit() {
    if (!body) return
    if (!selection?.include_all_source && selection?.battery_ids.length === 0) {
      toast.error(t("workflow.split.noScope"))
      return
    }
    if (
      method === "random" &&
      Math.round(Number(ratios.train) + Number(ratios.val) + Number(ratios.test)) !== 100
    ) {
      toast.error(t("workflow.split.ratioTotal"))
      return
    }
    if (
      method === "random" &&
      selection?.include_all_source === false &&
      !selection.battery_ids.length
    ) {
      toast.error(t("workflow.split.noScope"))
      return
    }
    previewMutation.mutate(body)
  }

  function saveSplit() {
    if (!body || !preview || preview.fingerprint !== currentFingerprint) {
      toast.error(t("workflow.split.previewRequired"))
      return
    }
    createMutation.mutate(body)
  }

  const ratioTotal = Number(ratios.train) + Number(ratios.val) + Number(ratios.test)
  const previewIsCurrent = Boolean(preview && preview.fingerprint === currentFingerprint)
  const manualCounts = PARTITIONS.reduce(
    (counts, partition) => {
      counts[partition] = Object.values(assignments).filter((value) => value === partition).length
      return counts
    },
    { train: 0, val: 0, test: 0 } as Record<Partition, number>,
  )

  return (
    <>
      <PageHeader
        title={t("workflow.split.title")}
        description={t("workflow.split.description")}
        actions={
          creating ? (
            <Button variant="outline" onClick={closeCreate}>
              <ArrowLeftIcon data-icon="inline-start" />
              {t("common.cancel")}
            </Button>
          ) : (
            <>
              <input
                ref={importInput}
                className="hidden"
                type="file"
                accept="application/json,.json"
                onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
              />
              <Button variant="outline" onClick={() => importInput.current?.click()}>
                <FileUpIcon data-icon="inline-start" />
                {t("workflow.split.importJson")}
              </Button>
              <Button onClick={openCreate}>
                <PlusIcon data-icon="inline-start" />
                {t("workflow.split.new")}
              </Button>
            </>
          )
        }
      />

      {!creating ? (
        <>
          {sourcesQuery.error ? (
            <ErrorState error={sourcesQuery.error} onRetry={() => void sourcesQuery.refetch()} />
          ) : null}
          <div className="flex flex-wrap items-end gap-3">
            <Field className="min-w-56">
              <FieldLabel htmlFor="split-source-filter">{t("workflow.split.source")}</FieldLabel>
              <Select
                value={sourceFilter || "all"}
                onValueChange={(value) => {
                  setSourceFilter(value === "all" ? "" : value)
                  setPage(1)
                }}
              >
                <SelectTrigger id="split-source-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">{t("common.all")}</SelectItem>
                    {(sourcesQuery.data?.items ?? []).map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <form
              className="flex min-w-56 flex-1 gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                setQuery(draftQuery)
                setPage(1)
              }}
            >
              <Input
                aria-label={t("workflow.dataset.search")}
                value={draftQuery}
                onChange={(event) => setDraftQuery(event.target.value)}
                placeholder={t("workflow.dataset.search")}
              />
              <Button type="submit" variant="outline">
                {t("workflow.dataset.applyFilters")}
              </Button>
            </form>
          </div>
          {splitsQuery.isLoading ? <LoadingState rows={4} /> : null}
          {splitsQuery.error ? (
            <ErrorState error={splitsQuery.error} onRetry={() => void splitsQuery.refetch()} />
          ) : null}
          {splitsQuery.data && splitsQuery.data.items.length === 0 ? (
            <EmptyState
              title={t("workflow.split.noScope")}
              action={<Button onClick={openCreate}>{t("workflow.split.new")}</Button>}
            />
          ) : null}
          {splitsQuery.data && splitsQuery.data.items.length > 0 ? (
            <div className="flex flex-col gap-3">
              {splitsQuery.data.items.map((split) => {
                const counts = splitCounts(split)
                return (
                  <Card key={split.id}>
                    <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <LayersIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                          <h2 className="truncate font-medium">{split.name}</h2>
                          <Badge variant="outline">v{split.version}</Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          {PARTITIONS.map((part) => (
                            <span key={part}>
                              {t(PARTITION_KEYS[part])}: {counts[part]}
                            </span>
                          ))}
                          <span className="font-mono">{shortId(split.id)}</span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void endpoints.splits.export(split.id, split.version)}
                      >
                        <DownloadIcon data-icon="inline-start" />
                        {t("workflow.split.exportJson")}
                      </Button>
                    </CardContent>
                  </Card>
                )
              })}
              <PaginationControls
                page={page}
                pageSize={pageSize}
                total={splitsQuery.data.total}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            </div>
          ) : null}
          {importFile ? (
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="truncate text-sm">{importFile.name}</span>
                <div className="flex gap-2">
                  <Select
                    onValueChange={(sourceId) =>
                      importMutation.mutate({ sourceId, file: importFile })
                    }
                  >
                    <SelectTrigger className="min-w-56">
                      <SelectValue placeholder={t("workflow.split.chooseSource")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {sources.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="ghost" onClick={() => setImportFile(null)}>
                    {t("common.cancel")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : (
        <div className="flex flex-col gap-5">
          <ol className="grid gap-2 sm:grid-cols-3" aria-label={t("workflow.split.title")}>
            {[
              t("workflow.split.stepScope"),
              t("workflow.split.stepPartition"),
              t("workflow.split.stepReview"),
            ].map((label, index) => (
              <li
                key={label}
                aria-current={step === index ? "step" : undefined}
                className={`rounded-md border px-3 py-2 text-sm ${step === index ? "border-primary bg-accent font-medium text-accent-foreground" : "text-muted-foreground"}`}
              >
                <span className="mr-2 font-mono">0{index + 1}</span>
                {label}
              </li>
            ))}
          </ol>

          {step === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("workflow.split.stepScope")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {selection ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field>
                      <FieldLabel>{t("workflow.split.name")}</FieldLabel>
                      <Input value={name} onChange={(event) => setName(event.target.value)} />
                    </Field>
                    <Field>
                      <FieldLabel>{t("workflow.split.source")}</FieldLabel>
                      <Input value={source?.name ?? selection.source_id} disabled />
                    </Field>
                    <div className="rounded-md border bg-muted/40 p-3 text-sm sm:col-span-2">
                      {selection.include_all_source
                        ? t("workflow.split.fullSource")
                        : t("workflow.split.selectedCount", {
                            count: selection.battery_ids.length,
                          })}
                    </div>
                    <p className="text-sm text-muted-foreground sm:col-span-2">
                      {selection.include_all_source
                        ? t("workflow.split.manualHint")
                        : t("workflow.split.manualHint")}
                    </p>
                  </div>
                ) : (
                  <EmptyState
                    title={t("workflow.split.noScope")}
                    action={
                      <Button asChild>
                        <Link to="/resources">{t("workflow.dataset.title")}</Link>
                      </Button>
                    }
                  />
                )}
                <div className="flex justify-end">
                  <Button onClick={() => setStep(1)} disabled={!selection || !name.trim()}>
                    {t("common.next")}
                    <ArrowRightIcon data-icon="inline-end" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {step === 1 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("workflow.split.stepPartition")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <Field>
                  <FieldLabel htmlFor="split-method">{t("workflow.split.strategy")}</FieldLabel>
                  <Select
                    value={method}
                    onValueChange={(value) => {
                      setMethod(value as PartitionMethod)
                      setPreview(null)
                    }}
                  >
                    <SelectTrigger id="split-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="random">{t("workflow.split.random")}</SelectItem>
                        <SelectItem value="manual" disabled={selection?.include_all_source}>
                          {t("workflow.split.manual")}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                {method === "random" ? (
                  <FieldGroup className="grid gap-3 sm:grid-cols-4">
                    {PARTITIONS.map((partition) => (
                      <Field key={partition}>
                        <FieldLabel htmlFor={`ratio-${partition}`}>
                          {t(PARTITION_KEYS[partition])} (%)
                        </FieldLabel>
                        <Input
                          id={`ratio-${partition}`}
                          type="number"
                          min="0"
                          max="100"
                          value={ratios[partition]}
                          onChange={(event) => updateRatio(partition, event.target.value)}
                        />
                      </Field>
                    ))}
                    <Field>
                      <FieldLabel htmlFor="split-seed">{t("workflow.split.seed")}</FieldLabel>
                      <Input
                        id="split-seed"
                        type="number"
                        min="0"
                        value={seed}
                        onChange={(event) => {
                          setSeed(event.target.value)
                          setPreview(null)
                        }}
                      />
                    </Field>
                    <p
                      className={`self-end pb-2 text-sm ${ratioTotal === 100 ? "text-muted-foreground" : "text-destructive"}`}
                    >
                      {t("workflow.split.ratios")}: {ratioTotal}%
                      {ratioTotal === 100 ? "" : ` · ${t("workflow.split.ratioTotal")}`}
                    </p>
                  </FieldGroup>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {PARTITIONS.map((partition) => (
                        <Button
                          key={partition}
                          size="sm"
                          variant="outline"
                          disabled={selectedRows.size === 0}
                          onClick={() => assignSelected(partition)}
                        >
                          {t("workflow.split.assignSelected", {
                            partition: t(PARTITION_KEYS[partition]),
                          })}
                        </Button>
                      ))}
                    </div>
                    {rows.length > 0 ? (
                      <div className="overflow-x-auto rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-10">
                                <Checkbox
                                  aria-label={t("workflow.dataset.selectPage")}
                                  checked={
                                    visibleAssignments.length > 0 &&
                                    visibleAssignments.every(([id]) => selectedRows.has(id))
                                  }
                                  onCheckedChange={(checked) => setPageRows(checked === true)}
                                />
                              </TableHead>
                              <TableHead>{t("workflow.dataset.columns.file")}</TableHead>
                              <TableHead>{t("workflow.split.strategy")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {visibleAssignments.map(([id, file]) => (
                              <TableRow key={id}>
                                <TableCell>
                                  <Checkbox
                                    aria-label={file.file_name}
                                    checked={selectedRows.has(id)}
                                    onCheckedChange={(checked) =>
                                      setSelectedRows((current) => {
                                        const next = new Set(current)
                                        if (checked === true) next.add(id)
                                        else next.delete(id)
                                        return next
                                      })
                                    }
                                  />
                                </TableCell>
                                <TableCell>
                                  <span className="font-medium">{file.file_name}</span>
                                  <span className="block truncate font-mono text-xs text-muted-foreground">
                                    {file.relative_key}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <Select
                                    value={assignments[id] ?? "train"}
                                    onValueChange={(value) =>
                                      changeAssignment(id, value as Partition)
                                    }
                                  >
                                    <SelectTrigger className="w-40">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectGroup>
                                        {PARTITIONS.map((partition) => (
                                          <SelectItem key={partition} value={partition}>
                                            {t(PARTITION_KEYS[partition])}
                                          </SelectItem>
                                        ))}
                                      </SelectGroup>
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {t("workflow.split.manualHint")}
                      </p>
                    )}
                    {rows.length > 50 ? (
                      <PaginationControls
                        page={assignmentPage}
                        pageSize={50}
                        total={rows.length}
                        onPageChange={setAssignmentPage}
                      />
                    ) : null}
                    <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                      {PARTITIONS.map((partition) => (
                        <span key={partition}>
                          {t(PARTITION_KEYS[partition])}: {manualCounts[partition]}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setStep(0)}>
                    <ArrowLeftIcon data-icon="inline-start" />
                    {t("common.back")}
                  </Button>
                  <Button
                    onClick={previewSplit}
                    disabled={
                      !body ||
                      previewMutation.isPending ||
                      (method === "random" && ratioTotal !== 100)
                    }
                  >
                    {previewMutation.isPending ? t("common.loading") : t("workflow.split.preview")}
                  </Button>
                </div>
                {previewMutation.error ? <ErrorState error={previewMutation.error} /> : null}
              </CardContent>
            </Card>
          ) : null}

          {step === 2 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("workflow.split.previewTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {previewIsCurrent && preview ? (
                  <div className="grid gap-3 sm:grid-cols-4">
                    {PARTITIONS.map((partition) => (
                      <div key={partition} className="rounded-lg border bg-card p-4">
                        <p className="text-sm text-muted-foreground">
                          {t(PARTITION_KEYS[partition])}
                        </p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums">
                          {preview.value.counts[partition]}
                        </p>
                      </div>
                    ))}
                    <div className="rounded-lg border bg-muted/40 p-4">
                      <p className="text-sm text-muted-foreground">{t("workflow.split.total")}</p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums">
                        {preview.value.counts.all}
                      </p>
                    </div>
                  </div>
                ) : (
                  <ErrorState error={new Error(t("workflow.split.changedAfterPreview"))} />
                )}
                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setStep(1)}>
                    <ArrowLeftIcon data-icon="inline-start" />
                    {t("common.back")}
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={!body || previewMutation.isPending}
                      onClick={previewSplit}
                    >
                      {t("workflow.split.preview")}
                    </Button>
                    <Button
                      onClick={saveSplit}
                      disabled={!previewIsCurrent || createMutation.isPending}
                    >
                      {createMutation.isPending ? t("common.saving") : t("workflow.split.save")}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </>
  )
}
