import {
  DownloadIcon,
  FileUpIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { toast } from "sonner"

import { errorMessage, fieldErrors } from "@/api/client"
import { endpoints } from "@/api/endpoints"
import type { Battery, Split, SplitPreviewResponse, SplitWrite } from "@/api/models"
import { ConfirmButton } from "@/components/confirm-button"
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state"
import { PageHeader } from "@/components/page-header"
import { PaginationControls } from "@/components/pagination-controls"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useApiQuery } from "@/hooks/use-api-query"
import { enumLabel, formatDate, shortId } from "@/lib/format"
import { cn } from "@/lib/utils"

type Partition = "train" | "val" | "test"
type Method = "manual" | "random" | "hybrid"
type SelectionMode = "all" | "selected"

type SplitForm = {
  name: string
  sourceId: string
  method: Method
  ratios: Record<Partition, string>
  seed: string
}

const DEFAULT_RATIOS = { train: "0.7", val: "0.15", test: "0.15" }
const RATIO_ACCENTS: Record<Partition, string> = {
  train: "accent-chart-1",
  val: "accent-chart-2",
  test: "accent-chart-3",
}
const SOURCE_ACCENTS = [
  "border-l-chart-1",
  "border-l-chart-2",
  "border-l-chart-3",
  "border-l-chart-4",
  "border-l-chart-5",
] as const

function sourceAccent(identity: string): string {
  const hash = Array.from(identity).reduce((value, character) => value + character.charCodeAt(0), 0)
  return SOURCE_ACCENTS[hash % SOURCE_ACCENTS.length]
}

const EMPTY_FORM: SplitForm = {
  name: "",
  sourceId: "",
  method: "random",
  ratios: DEFAULT_RATIOS,
  seed: "42",
}

function updateRatios(
  current: Record<Partition, string>,
  changed: Partition,
  percentage: number,
): Record<Partition, string> {
  const rest = (["train", "val", "test"] as const).filter((partition) => partition !== changed)
  const remainder = 100 - percentage
  const prior = rest.map((partition) => Number(current[partition]) * 100)
  const priorTotal = prior[0] + prior[1]
  const first = priorTotal > 0 ? Math.round((remainder * prior[0]) / priorTotal) : remainder / 2
  const values = {
    [changed]: percentage,
    [rest[0]]: first,
    [rest[1]]: remainder - first,
  } as Record<Partition, number>
  return Object.fromEntries(
    Object.entries(values).map(([partition, value]) => [partition, String(value / 100)]),
  ) as Record<Partition, string>
}

type SplitPayload = {
  include_all_source?: boolean
  source_revision?: number
  method?: string
  seed?: number | null
  parameters?: { ratios?: Record<string, number> | null } | null
  train?: string[]
  val?: string[]
  test?: string[]
}

function splitPayload(split: Split): SplitPayload {
  return (split.payload ?? {}) as SplitPayload
}

function assignmentMapFromSplit(split: Split): Record<string, Partition> {
  const payload = splitPayload(split)
  const result: Record<string, Partition> = {}
  for (const partition of ["train", "val", "test"] as const) {
    for (const identity of payload[partition] ?? []) {
      result[String(identity)] = partition
    }
  }
  return result
}

function splitMemberIds(split: Split): string[] {
  const payload = splitPayload(split)
  return [
    ...new Set(
      (["train", "val", "test"] as const).flatMap((partition) =>
        (payload[partition] ?? []).map(String),
      ),
    ),
  ]
}

export function SplitsPage() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [query, setQuery] = useState("")
  const [draftQuery, setDraftQuery] = useState("")
  const [sourceId, setSourceId] = useState("")

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Split | null>(null)
  const [form, setForm] = useState<SplitForm>(EMPTY_FORM)
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("all")
  const [preview, setPreview] = useState<{
    fingerprint: string
    data: SplitPreviewResponse
  } | null>(null)
  const [assignments, setAssignments] = useState<Record<string, Partition>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batteryQuery, setBatteryQuery] = useState("")
  const [batteryDraft, setBatteryDraft] = useState("")
  const [batteryPage, setBatteryPage] = useState(1)
  const [batteryNames, setBatteryNames] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [formFields, setFormFields] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)

  const [importOpen, setImportOpen] = useState(false)
  const [importSource, setImportSource] = useState("")
  const [importFile, setImportFile] = useState<File | null>(null)

  const [detail, setDetail] = useState<Split | null>(null)
  const [detailVersion, setDetailVersion] = useState<number | undefined>(undefined)
  const [detailPartition, setDetailPartition] = useState<Partition>("train")
  const [detailPage, setDetailPage] = useState(1)

  const sources = useApiQuery(
    (signal) => endpoints.sources.list({ page: 1, pageSize: 100 }, signal),
    [],
  )
  const splits = useApiQuery(
    (signal) =>
      endpoints.splits.list(
        {
          page,
          pageSize,
          q: query || undefined,
          sourceId: sourceId || undefined,
        },
        signal,
      ),
    [page, pageSize, query, sourceId],
  )
  const detailSplit = useApiQuery(
    (signal) =>
      detail
        ? endpoints.splits.get(detail.id, detailVersion ?? detail.version, signal)
        : Promise.resolve(null),
    [detail?.id, detailVersion],
    { enabled: Boolean(detail) },
  )
  const members = useApiQuery(
    (signal) =>
      detail
        ? endpoints.splits.members(
            detail.id,
            {
              version: detailVersion ?? detail.version,
              partition: detailPartition,
              page: detailPage,
              pageSize: 100,
            },
            signal,
          )
        : Promise.resolve(null),
    [detail?.id, detailVersion, detailPartition, detailPage],
    { enabled: Boolean(detail) },
  )
  const picker = useApiQuery(
    (signal) =>
      formOpen && form.sourceId
        ? endpoints.batteries.list(
            {
              page: batteryPage,
              pageSize: 100,
              sourceId: form.sourceId,
              q: batteryQuery || undefined,
            },
            signal,
          )
        : Promise.resolve(null),
    [formOpen, form.sourceId, batteryPage, batteryQuery],
    { enabled: formOpen && Boolean(form.sourceId) },
  )

  const sourcesById = useMemo(
    () => Object.fromEntries((sources.data?.items ?? []).map((source) => [source.id, source])),
    [sources.data],
  )
  const hasRegisteredBatteries = (sources.data?.items ?? []).some(
    (source) => source.battery_count > 0,
  )
  const requestBody = useMemo<SplitWrite>(() => {
    const partitions: Record<Partition, string[]> = { train: [], val: [], test: [] }
    if (selectionMode === "selected" && form.method !== "random") {
      for (const identity of selected) {
        const partition = assignments[identity]
        if (partition) partitions[partition].push(identity)
      }
    }
    return {
      name: form.name.trim(),
      source_id: form.sourceId,
      battery_ids: selectionMode === "all" ? [] : [...selected].sort(),
      include_all_source: selectionMode === "all",
      expected_source_revision: sourcesById[form.sourceId]?.revision ?? 0,
      method: form.method,
      ...(selectionMode === "all" || form.method === "random" ? {} : { partitions }),
      ...(selectionMode === "all" || form.method !== "manual"
        ? {
            ratios: {
              train: Number(form.ratios.train),
              val: Number(form.ratios.val),
              test: Number(form.ratios.test),
            },
            seed: Number(form.seed),
          }
        : {}),
    }
  }, [form, selectionMode, selected, assignments, sourcesById])
  const requestFingerprint = JSON.stringify(requestBody)
  const currentPreview = preview?.fingerprint === requestFingerprint ? preview.data : undefined

  function openCreate() {
    setEditing(null)
    setForm({ ...EMPTY_FORM })
    setSelectionMode("all")
    setPreview(null)
    setAssignments({})
    setSelected(new Set())
    setBatteryNames({})
    setBatteryQuery("")
    setBatteryDraft("")
    setBatteryPage(1)
    setFormError(null)
    setFormFields({})
    setFormOpen(true)
  }

  function openEdit(split: Split) {
    setEditing(split)
    const wholeSource = Boolean(splitPayload(split).include_all_source)
    setSelectionMode(wholeSource ? "all" : "selected")
    setPreview(null)
    setForm({
      name: split.name,
      sourceId: split.source_id,
      method: (splitPayload(split).method as Method) ?? "manual",
      ratios: {
        train: String(splitPayload(split).parameters?.ratios?.train ?? DEFAULT_RATIOS.train),
        val: String(splitPayload(split).parameters?.ratios?.val ?? DEFAULT_RATIOS.val),
        test: String(splitPayload(split).parameters?.ratios?.test ?? DEFAULT_RATIOS.test),
      },
      seed: String(splitPayload(split).seed ?? 42),
    })
    const ids = wholeSource ? [] : splitMemberIds(split)
    setSelected(new Set(ids))
    setAssignments(wholeSource ? {} : assignmentMapFromSplit(split))
    setBatteryNames({})
    setBatteryQuery("")
    setBatteryDraft("")
    setBatteryPage(1)
    setFormError(null)
    setFormFields({})
    setFormOpen(true)
    if (!wholeSource) void loadMemberNames(split.id, split.version ?? 1)
  }

  async function beginEdit(split: Split) {
    try {
      openEdit(await endpoints.splits.get(split.id, split.version))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function loadMemberNames(id: string, version: number) {
    try {
      const pages = await Promise.all(
        (["train", "val", "test"] as const).map((partition) =>
          endpoints.splits.members(id, { version, partition, page: 1, pageSize: 200 }),
        ),
      )
      const names: Record<string, string> = {}
      for (const result of pages) {
        for (const battery of result.items) {
          names[battery.id] = battery.file_name
        }
      }
      setBatteryNames(names)
    } catch {
      // Names are a display convenience; identifiers remain usable.
    }
  }

  function toggleBattery(battery: Battery) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(battery.id)) {
        next.delete(battery.id)
        setAssignments((values) => {
          const copy = { ...values }
          delete copy[battery.id]
          return copy
        })
      } else {
        next.add(battery.id)
        setAssignments((values) => ({
          ...values,
          [battery.id]: form.method === "manual" ? "train" : (values[battery.id] ?? "train"),
        }))
      }
      return next
    })
    setBatteryNames((current) => ({ ...current, [battery.id]: battery.file_name }))
  }

  function validateForm(): string | null {
    if (!form.name.trim()) {
      return t("splits.messages.nameRequired")
    }
    if (!form.sourceId) {
      return t("splits.messages.sourceRequired")
    }
    const sourceBatteryCount = sourcesById[form.sourceId]?.battery_count ?? 0
    if (selectionMode === "all" ? sourceBatteryCount === 0 : selected.size === 0) {
      return selectionMode === "all"
        ? t("splits.messages.sourceHasNoBatteries")
        : t("splits.messages.batteriesRequired")
    }
    if (selectionMode === "selected" && form.method === "manual") {
      if (Object.keys(assignments).length !== selected.size) {
        return t("splits.messages.manualAll")
      }
    } else if (selectionMode === "all" || form.method !== "manual") {
      const values = (["train", "val", "test"] as const).map((key) => Number(form.ratios[key]))
      if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
        return t("splits.messages.ratiosRange")
      }
      if (Math.abs(values.reduce((total, value) => total + value, 0) - 1) > 1e-9) {
        return t("splits.messages.ratiosSum")
      }
      const seed = Number(form.seed)
      if (!Number.isInteger(seed) || seed < 0 || seed >= 2 ** 32) {
        return t("splits.messages.seedRange")
      }
    }
    return null
  }

  function formErrorMessage(error: unknown): string {
    if (error instanceof Error && "symbol" in error) {
      const apiError = error as Error & { symbol?: string }
      const message = apiError.message.toLowerCase()
      if (apiError.symbol === "conflict" && message.includes("source revision")) {
        return t("splits.messages.sourceChanged")
      }
      if (apiError.symbol === "conflict" && message.includes("split revision")) {
        return t("splits.messages.splitChanged")
      }
    }
    return errorMessage(error)
  }

  async function previewForm() {
    const failure = validateForm()
    if (failure) {
      setFormError(failure)
      return
    }
    setPending(true)
    setFormError(null)
    setFormFields({})
    try {
      const result = await endpoints.splits.preview(requestBody)
      setPreview({ fingerprint: requestFingerprint, data: result })
    } catch (error) {
      setFormError(formErrorMessage(error))
      setFormFields(fieldErrors(error))
      sources.refresh()
    } finally {
      setPending(false)
    }
  }

  async function submitForm() {
    const failure = validateForm()
    if (failure) {
      setFormError(failure)
      return
    }
    if (!currentPreview) {
      setFormError(t("splits.messages.previewRequired"))
      return
    }
    setPending(true)
    setFormError(null)
    setFormFields({})
    const body = { ...requestBody, expected_source_revision: currentPreview.source_revision }
    try {
      if (editing) {
        await endpoints.splits.update(editing.id, {
          ...body,
          expected_revision: editing.revision,
        })
        toast.success(t("splits.messages.updated"))
      } else {
        await endpoints.splits.create(body)
        toast.success(t("splits.messages.created"))
      }
      setFormOpen(false)
      splits.refresh()
    } catch (error) {
      setFormError(formErrorMessage(error))
      setFormFields(fieldErrors(error))
      if (
        error instanceof Error &&
        "symbol" in error &&
        (error as { symbol?: string }).symbol === "conflict"
      ) {
        splits.refresh()
        sources.refresh()
      }
    } finally {
      setPending(false)
    }
  }

  async function importSplit() {
    if (!importSource || !importFile) {
      toast.error(t("splits.messages.importRequired"))
      return
    }
    setPending(true)
    try {
      await endpoints.splits.import(importSource, importFile)
      toast.success(t("splits.messages.imported"))
      setImportOpen(false)
      setImportFile(null)
      splits.refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  const selectedList = [...selected]
  const pickerItems = picker.data?.items ?? []

  return (
    <>
      <PageHeader
        title={t("splits.title")}
        actions={
          <>
            <Dialog open={importOpen} onOpenChange={setImportOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <FileUpIcon data-icon="inline-start" />
                  {t("splits.importSplit")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("splits.importTitle")}</DialogTitle>
                  <DialogDescription className="sr-only">
                    {t("splits.importDescription")}
                  </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="split-import-source">{t("splits.source")}</FieldLabel>
                    <Select value={importSource} onValueChange={setImportSource}>
                      <SelectTrigger id="split-import-source">
                        <SelectValue placeholder={t("splits.chooseSource")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {(sources.data?.items ?? []).map((source) => (
                            <SelectItem key={source.id} value={source.id}>
                              {source.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="split-import-file">{t("splits.importFile")}</FieldLabel>
                    <Input
                      id="split-import-file"
                      type="file"
                      accept="application/json,.json"
                      onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                    />
                    <FieldDescription>{t("splits.importLimit")}</FieldDescription>
                  </Field>
                </FieldGroup>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setImportOpen(false)}>
                    {t("common.cancel")}
                  </Button>
                  <Button onClick={importSplit} disabled={pending || !importFile}>
                    {pending ? t("common.uploading") : t("common.import")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button onClick={openCreate} disabled={!hasRegisteredBatteries}>
              <PlusIcon data-icon="inline-start" />
              {t("splits.newSplit")}
            </Button>
          </>
        }
      />

      {sources.error ? <ErrorState error={sources.error} onRetry={sources.refresh} /> : null}

      {sources.data && !hasRegisteredBatteries ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed bg-muted/20 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {sources.data.items.length
              ? t("splits.messages.noRegisteredBatteries")
              : t("splits.messages.noRegisteredSources")}
          </p>
          <Button asChild size="sm" variant="outline">
            <Link to="/resources">{t("splits.messages.openSources")}</Link>
          </Button>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("splits.listTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              setPage(1)
              setQuery(draftQuery)
            }}
          >
            <Field className="w-56">
              <FieldLabel htmlFor="split-source">{t("splits.sourceFilter")}</FieldLabel>
              <Select
                value={sourceId || "all"}
                onValueChange={(value) => {
                  setSourceId(value === "all" ? "" : value)
                  setPage(1)
                }}
              >
                <SelectTrigger id="split-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">{t("common.allSources")}</SelectItem>
                    {(sources.data?.items ?? []).map((source) => (
                      <SelectItem key={source.id} value={source.id}>
                        {source.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field className="w-64">
              <FieldLabel htmlFor="split-q">{t("splits.nameFilter")}</FieldLabel>
              <Input
                id="split-q"
                value={draftQuery}
                onChange={(event) => setDraftQuery(event.target.value)}
              />
            </Field>
            <Button type="submit" variant="outline">
              <SearchIcon data-icon="inline-start" />
              {t("splits.search")}
            </Button>
          </form>

          {splits.loading && splits.data === undefined ? <LoadingState rows={4} /> : null}
          {splits.error ? <ErrorState error={splits.error} onRetry={splits.refresh} /> : null}
          {splits.data && splits.data.items.length === 0 ? (
            <EmptyState
              title={t("splits.emptyTitle")}
              description={t("splits.emptyDescription")}
              action={
                <Button onClick={openCreate} disabled={!hasRegisteredBatteries}>
                  {t("splits.newSplit")}
                </Button>
              }
            />
          ) : null}
          {splits.data && splits.data.items.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("splits.columns.name")}</TableHead>
                      <TableHead>{t("splits.columns.source")}</TableHead>
                      <TableHead>{t("splits.columns.train")}</TableHead>
                      <TableHead>{t("splits.columns.val")}</TableHead>
                      <TableHead>{t("splits.columns.test")}</TableHead>
                      <TableHead>{t("splits.columns.version")}</TableHead>
                      <TableHead>{t("splits.columns.revision")}</TableHead>
                      <TableHead>{t("splits.columns.createdAt")}</TableHead>
                      <TableHead className="text-right">{t("splits.columns.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {splits.data.items.map((split) => (
                      <TableRow key={split.id}>
                        <TableCell className="max-w-48 truncate font-medium">
                          {split.name}
                        </TableCell>
                        <TableCell>
                          {sourcesById[split.source_id]?.name ?? shortId(split.source_id)}
                        </TableCell>
                        <TableCell>{split.counts.train ?? 0}</TableCell>
                        <TableCell>{split.counts.val ?? 0}</TableCell>
                        <TableCell>{split.counts.test ?? 0}</TableCell>
                        <TableCell>
                          {t("common.versionSummary", {
                            version: split.version,
                            head: split.head_version,
                          })}
                        </TableCell>
                        <TableCell>{split.revision}</TableCell>
                        <TableCell>{formatDate(split.created_at)}</TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setDetail(split)
                                setDetailVersion(undefined)
                                setDetailPartition("train")
                                setDetailPage(1)
                              }}
                            >
                              {t("splits.view")}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => void beginEdit(split)}>
                              <PencilIcon data-icon="inline-start" />
                              {t("splits.edit")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                endpoints.splits
                                  .export(split.id, split.version)
                                  .then(() => toast.success(t("common.exportStarted")))
                                  .catch((error: unknown) => toast.error(errorMessage(error)))
                              }
                            >
                              <DownloadIcon data-icon="inline-start" />
                              {t("splits.export")}
                            </Button>
                            <ConfirmButton
                              title={t("splits.deleteTitle")}
                              description={t("splits.deleteDescription")}
                              onConfirm={async () => {
                                try {
                                  await endpoints.splits.remove(split.id)
                                  toast.success(t("splits.messages.deleted"))
                                  splits.refresh()
                                } catch (error) {
                                  toast.error(errorMessage(error))
                                }
                              }}
                            >
                              <Trash2Icon data-icon="inline-start" />
                              {t("splits.delete")}
                            </ConfirmButton>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <PaginationControls
                page={page}
                pageSize={pageSize}
                total={splits.data.total}
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

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="top-0 right-0 left-auto h-dvh max-h-dvh w-full max-w-3xl translate-x-0 translate-y-0 overflow-y-auto rounded-none border-l p-5 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? t("splits.editTitle") : t("splits.createTitle")}</DialogTitle>
            <DialogDescription className="sr-only">
              {editing
                ? t("splits.editDescription", { revision: editing.revision })
                : t("splits.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel>{t("splits.form.source")}</FieldLabel>
              {editing ? (
                <div className="flex items-center gap-3 rounded-lg border border-l-4 border-l-chart-1 bg-muted/20 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {sourcesById[form.sourceId]?.name ?? shortId(form.sourceId)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("splits.form.sourceBatteryCount", {
                        count: sourcesById[form.sourceId]?.battery_count ?? 0,
                      })}
                    </p>
                  </div>
                  <Badge variant="outline">{t("splits.form.sourceLocked")}</Badge>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {(sources.data?.items ?? []).map((source) => {
                    const accent = sourceAccent(source.id)
                    const active = form.sourceId === source.id
                    return (
                      <button
                        key={source.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          setForm((current) => ({ ...current, sourceId: source.id }))
                          setSelected(new Set())
                          setAssignments({})
                          setBatteryPage(1)
                        }}
                        className={cn(
                          "flex min-h-20 items-center gap-3 rounded-lg border border-l-4 p-3 text-left transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring",
                          accent,
                          active ? "bg-muted/50 ring-1 ring-primary/40" : "bg-card",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{source.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {t("splits.form.sourceBatteryCount", {
                              count: source.battery_count,
                            })}
                          </p>
                        </div>
                        <Badge variant={active ? "default" : "outline"}>
                          {enumLabel(source.availability, "availability")}
                        </Badge>
                      </button>
                    )
                  })}
                </div>
              )}
            </Field>

            {form.sourceId ? (
              <Field>
                <FieldLabel>{t("splits.form.selectionMode")}</FieldLabel>
                <ToggleGroup
                  type="single"
                  value={selectionMode}
                  variant="outline"
                  onValueChange={(value) => {
                    if (value !== "all" && value !== "selected") return
                    setSelectionMode(value)
                    setSelected(new Set())
                    setAssignments({})
                    setBatteryPage(1)
                    if (value === "all") {
                      setForm((current) => ({ ...current, method: "random" }))
                    }
                  }}
                  className="grid w-full grid-cols-2"
                >
                  <ToggleGroupItem value="all" className="h-auto min-h-12 flex-col gap-0.5 py-2">
                    <span>{t("splits.form.useWholeSource")}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {t("splits.form.sourceBatteryCount", {
                        count: sourcesById[form.sourceId]?.battery_count ?? 0,
                      })}
                    </span>
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="selected"
                    className="h-auto min-h-12 flex-col gap-0.5 py-2"
                  >
                    <span>{t("splits.form.selectPartOfSource")}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {t("splits.form.selectedBatteryHint")}
                    </span>
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={Boolean(formFields.name)}>
                <FieldLabel htmlFor="split-name">{t("splits.form.name")}</FieldLabel>
                <Input
                  id="split-name"
                  value={form.name}
                  aria-invalid={Boolean(formFields.name)}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
                <FieldError>{formFields.name}</FieldError>
              </Field>
              <Field>
                <FieldLabel htmlFor="split-method">{t("splits.form.method")}</FieldLabel>
                <Select
                  value={form.method}
                  disabled={selectionMode === "all"}
                  onValueChange={(value: Method) => {
                    setForm((current) => ({ ...current, method: value }))
                    if (value === "manual") {
                      setAssignments((current) =>
                        Object.fromEntries(
                          [...selected].map((identity) => [identity, current[identity] ?? "train"]),
                        ),
                      )
                    }
                  }}
                >
                  <SelectTrigger id="split-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="manual">{t("splits.form.methodManual")}</SelectItem>
                      <SelectItem value="random">{t("splits.form.methodRandom")}</SelectItem>
                      <SelectItem value="hybrid">{t("splits.form.methodHybrid")}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="split-seed">{t("splits.form.seed")}</FieldLabel>
                <Input
                  id="split-seed"
                  inputMode="numeric"
                  value={form.seed}
                  disabled={form.method === "manual"}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, seed: event.target.value }))
                  }
                />
              </Field>
            </div>

            {form.method !== "manual" ? (
              <div className="flex flex-col gap-3 rounded-lg border bg-muted/10 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{t("splits.form.ratioDistribution")}</p>
                  <span className="text-xs text-muted-foreground">
                    {t("splits.form.ratioTotal", {
                      total: Math.round(
                        (Number(form.ratios.train) +
                          Number(form.ratios.val) +
                          Number(form.ratios.test)) *
                          100,
                      ),
                    })}
                  </span>
                </div>
                <div
                  aria-label={t("splits.form.ratioDistribution")}
                  className="flex h-2 overflow-hidden rounded-full bg-muted"
                  role="img"
                >
                  {(["train", "val", "test"] as const).map((partition, index) => (
                    <span
                      key={partition}
                      className={["bg-chart-1", "bg-chart-2", "bg-chart-3"][index]}
                      style={{ width: `${Number(form.ratios[partition]) * 100}%` }}
                    />
                  ))}
                </div>
                {(["train", "val", "test"] as const).map((partition) => (
                  <Field key={partition} className="grid grid-cols-[1fr_auto] items-center gap-x-4">
                    <FieldLabel htmlFor={`ratio-${partition}`}>
                      {t("splits.form.ratio", { partition: t(`splits.partitions.${partition}`) })}
                    </FieldLabel>
                    <output
                      className="text-sm tabular-nums text-muted-foreground"
                      htmlFor={`ratio-${partition}`}
                    >
                      {Math.round(Number(form.ratios[partition]) * 100)}%
                    </output>
                    <input
                      id={`ratio-${partition}`}
                      aria-label={t("splits.form.ratio", {
                        partition: t(`splits.partitions.${partition}`),
                      })}
                      className={cn(
                        "col-span-2 h-4 w-full cursor-pointer",
                        RATIO_ACCENTS[partition],
                      )}
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(Number(form.ratios[partition]) * 100)}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          ratios: updateRatios(
                            current.ratios,
                            partition,
                            Number(event.target.value),
                          ),
                        }))
                      }
                    />
                  </Field>
                ))}
              </div>
            ) : null}

            {selectionMode === "selected" ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{t("splits.form.selectBatteries")}</p>
                    <span className="text-xs text-muted-foreground">
                      {t("splits.form.selected", { count: selected.size })}
                    </span>
                  </div>
                  <form
                    className="flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      setBatteryPage(1)
                      setBatteryQuery(batteryDraft)
                    }}
                  >
                    <Input
                      aria-label={t("splits.form.searchBatteryAria")}
                      value={batteryDraft}
                      placeholder={t("splits.form.searchPlaceholder")}
                      onChange={(event) => setBatteryDraft(event.target.value)}
                    />
                    <Button type="submit" variant="outline" size="sm">
                      {t("splits.form.search")}
                    </Button>
                  </form>
                  <div className="max-h-72 overflow-y-auto rounded-md border">
                    {picker.loading && picker.data === undefined ? (
                      <div className="p-3">
                        <LoadingState rows={3} />
                      </div>
                    ) : null}
                    {picker.error ? (
                      <div className="p-3">
                        <ErrorState error={picker.error} onRetry={picker.refresh} />
                      </div>
                    ) : null}
                    {picker.data && pickerItems.length === 0 ? (
                      <p className="p-3 text-sm text-muted-foreground">
                        {t("splits.form.noMatch")}
                      </p>
                    ) : null}
                    {pickerItems.map((battery) => (
                      // biome-ignore lint/a11y/noLabelWithoutControl: Radix checkbox renders role=checkbox
                      <label
                        key={battery.id}
                        className="flex cursor-pointer items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/50"
                      >
                        <Checkbox
                          aria-label={battery.file_name}
                          checked={selected.has(battery.id)}
                          onCheckedChange={() => toggleBattery(battery)}
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">
                          {battery.file_name}
                        </span>
                      </label>
                    ))}
                  </div>
                  {picker.data && picker.data.total > 100 ? (
                    <PaginationControls
                      page={batteryPage}
                      pageSize={100}
                      total={picker.data.total}
                      onPageChange={setBatteryPage}
                    />
                  ) : null}
                </div>

                <div className="flex flex-col gap-2 rounded-md border p-3">
                  <p className="text-sm font-medium">{t("splits.form.assignments")}</p>
                  <p className="text-xs text-muted-foreground">
                    {form.method === "manual"
                      ? t("splits.form.assignmentHintManual")
                      : form.method === "hybrid"
                        ? t("splits.form.assignmentHintHybrid")
                        : t("splits.form.assignmentHintRandom")}
                  </p>
                  <div className="max-h-80 overflow-y-auto rounded-md border">
                    {selectedList.length === 0 ? (
                      <p className="p-3 text-sm text-muted-foreground">
                        {t("splits.form.noSelection")}
                      </p>
                    ) : null}
                    {selectedList.map((identity) => (
                      <div
                        key={identity}
                        className="flex items-center gap-2 border-b px-3 py-2 last:border-b-0"
                      >
                        <span
                          className="min-w-0 flex-1 truncate font-mono text-xs"
                          title={identity}
                        >
                          {batteryNames[identity] ?? shortId(identity)}
                        </span>
                        <Select
                          value={assignments[identity] ?? "unassigned"}
                          disabled={form.method === "random"}
                          onValueChange={(value) =>
                            setAssignments((current) => {
                              if (value === "unassigned") {
                                const copy = { ...current }
                                delete copy[identity]
                                return copy
                              }
                              return { ...current, [identity]: value as Partition }
                            })
                          }
                        >
                          <SelectTrigger
                            className="w-32"
                            aria-label={t("splits.form.memberPartitionAria")}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="unassigned">
                                {t("splits.form.unassigned")}
                              </SelectItem>
                              <SelectItem value="train">{t("splits.partitions.train")}</SelectItem>
                              <SelectItem value="val">{t("splits.partitions.val")}</SelectItem>
                              <SelectItem value="test">{t("splits.partitions.test")}</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border bg-muted/20 px-4 py-3 text-sm">
                <p className="font-medium">{t("splits.form.wholeSourceSummary")}</p>
                <p className="mt-1 text-muted-foreground">
                  {t("splits.form.randomWholeSourceHint", {
                    count: sourcesById[form.sourceId]?.battery_count ?? 0,
                  })}
                </p>
              </div>
            )}
            {formError ? <FieldError>{formError}</FieldError> : null}
            {Object.entries(formFields).length > 0 ? (
              <ul className="list-disc pl-5 text-sm text-destructive">
                {Object.entries(formFields).map(([path, message]) => (
                  <li key={path}>
                    {path}: {message}
                  </li>
                ))}
              </ul>
            ) : null}
          </FieldGroup>
          {currentPreview ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-4 py-3 text-sm">
              <span className="mr-auto font-medium">
                {t("splits.form.previewTotal", { count: currentPreview.counts.all })}
              </span>
              {(["train", "val", "test"] as const).map((partition) => (
                <Badge key={partition} variant="outline">
                  {t("splits.messages.previewCount", {
                    partition: t(`splits.partitions.${partition}`),
                    count: currentPreview.counts[partition],
                  })}
                </Badge>
              ))}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="outline" onClick={previewForm} disabled={pending}>
              {pending ? t("splits.form.previewing") : t("splits.form.preview")}
            </Button>
            <Button onClick={submitForm} disabled={pending || !currentPreview}>
              {pending
                ? t("common.saving")
                : editing
                  ? t("splits.form.saveNewVersion")
                  : t("splits.form.createSplit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{detail?.name ?? t("splits.detailTitle")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("splits.detailDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-2">
            <Field className="w-40">
              <FieldLabel htmlFor="detail-version">{t("splits.version")}</FieldLabel>
              <Input
                id="detail-version"
                inputMode="numeric"
                value={detailVersion ?? detail?.version ?? ""}
                onChange={(event) => {
                  const value = event.target.value
                  setDetailVersion(value ? Number(value) : undefined)
                  setDetailPage(1)
                }}
              />
            </Field>
            <Button
              variant="outline"
              onClick={() =>
                detail &&
                endpoints.splits
                  .export(detail.id, detailVersion ?? detail.version)
                  .then(() => toast.success(t("common.exportStarted")))
                  .catch((error: unknown) => toast.error(errorMessage(error)))
              }
            >
              <DownloadIcon data-icon="inline-start" />
              {t("splits.export")}
            </Button>
          </div>
          {detailSplit.error ? (
            <ErrorState error={detailSplit.error} onRetry={detailSplit.refresh} />
          ) : null}
          {detailSplit.data ? (
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">
                {t("splits.partitions.train")}: {detailSplit.data.counts.train ?? 0}
              </Badge>
              <Badge variant="outline">
                {t("splits.partitions.val")}: {detailSplit.data.counts.val ?? 0}
              </Badge>
              <Badge variant="outline">
                {t("splits.partitions.test")}: {detailSplit.data.counts.test ?? 0}
              </Badge>
              <span className="text-muted-foreground">
                {t("splits.revised", { revision: detailSplit.data.revision })}
              </span>
            </div>
          ) : null}
          <Tabs
            value={detailPartition}
            onValueChange={(value) => {
              setDetailPartition(value as Partition)
              setDetailPage(1)
            }}
          >
            <TabsList>
              {(["train", "val", "test"] as const).map((partition) => (
                <TabsTrigger key={partition} value={partition}>
                  {t(`splits.partitions.${partition}`)}
                </TabsTrigger>
              ))}
            </TabsList>
            {(["train", "val", "test"] as const).map((partition) => (
              <TabsContent key={partition} value={partition} className="flex flex-col gap-2">
                {members.loading && members.data === undefined ? <LoadingState rows={3} /> : null}
                {members.error ? (
                  <ErrorState error={members.error} onRetry={members.refresh} />
                ) : null}
                {members.data && members.data.items.length === 0 ? (
                  <EmptyState title={t("splits.membersEmpty")} />
                ) : null}
                {members.data && members.data.items.length > 0 ? (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("splits.columns.fileName")}</TableHead>
                          <TableHead>{t("splits.columns.availability")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {members.data.items.map((battery) => (
                          <TableRow key={battery.id}>
                            <TableCell className="font-mono text-xs">{battery.file_name}</TableCell>
                            <TableCell>{enumLabel(battery.availability, "availability")}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <PaginationControls
                      page={detailPage}
                      pageSize={100}
                      total={members.data.total}
                      onPageChange={setDetailPage}
                    />
                  </>
                ) : null}
              </TabsContent>
            ))}
          </Tabs>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
