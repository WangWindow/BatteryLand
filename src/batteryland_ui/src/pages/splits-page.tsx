import {
  DownloadIcon,
  FileUpIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { errorMessage, fieldErrors } from "@/api/client"
import { endpoints } from "@/api/endpoints"
import type { Battery, Split } from "@/api/models"
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
import { useApiQuery } from "@/hooks/use-api-query"
import { enumLabel, formatDate, shortId } from "@/lib/format"

type Partition = "train" | "val" | "test"
type Method = "manual" | "random" | "hybrid"

type SplitForm = {
  name: string
  sourceId: string
  method: Method
  ratios: Record<Partition, string>
  seed: string
}

const DEFAULT_RATIOS = { train: "0.7", val: "0.15", test: "0.15" }

const EMPTY_FORM: SplitForm = {
  name: "",
  sourceId: "",
  method: "manual",
  ratios: DEFAULT_RATIOS,
  seed: "42",
}

type SplitPayload = {
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

  useEffect(() => {
    if (!form.sourceId && sources.data?.items.length) {
      setForm((current) => ({ ...current, sourceId: sources.data?.items[0]?.id ?? "" }))
      setImportSource((current) => current || (sources.data?.items[0]?.id ?? ""))
    }
  }, [form.sourceId, sources.data])

  function openCreate() {
    setEditing(null)
    const firstSource = sources.data?.items[0]?.id ?? ""
    setForm({ ...EMPTY_FORM, sourceId: firstSource })
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
    const ids = splitMemberIds(split)
    setSelected(new Set(ids))
    setAssignments(assignmentMapFromSplit(split))
    setBatteryNames({})
    setBatteryQuery("")
    setBatteryDraft("")
    setBatteryPage(1)
    setFormError(null)
    setFormFields({})
    setFormOpen(true)
    void loadMemberNames(split.id, split.version ?? 1)
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
    if (selected.size === 0) {
      return t("splits.messages.batteriesRequired")
    }
    if (form.method === "manual") {
      if (Object.keys(assignments).length !== selected.size) {
        return t("splits.messages.manualAll")
      }
    } else {
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

  async function submitForm() {
    const failure = validateForm()
    if (failure) {
      setFormError(failure)
      return
    }
    setPending(true)
    setFormError(null)
    setFormFields({})
    const partitions: Record<Partition, string[]> = { train: [], val: [], test: [] }
    if (form.method !== "random") {
      for (const identity of selected) {
        const partition = assignments[identity]
        if (partition) {
          partitions[partition].push(identity)
        }
      }
    }
    const body = {
      name: form.name.trim(),
      source_id: form.sourceId,
      battery_ids: [...selected],
      method: form.method,
      ...(form.method === "random" ? {} : { partitions }),
      ...(form.method === "manual"
        ? {}
        : {
            ratios: {
              train: Number(form.ratios.train),
              val: Number(form.ratios.val),
              test: Number(form.ratios.test),
            },
            seed: Number(form.seed),
          }),
    }
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
      setFormError(errorMessage(error))
      setFormFields(fieldErrors(error))
      if (
        error instanceof Error &&
        "symbol" in error &&
        (error as { symbol?: string }).symbol === "conflict"
      ) {
        splits.refresh()
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
            <Button onClick={openCreate} disabled={(sources.data?.items.length ?? 0) === 0}>
              <PlusIcon data-icon="inline-start" />
              {t("splits.newSplit")}
            </Button>
          </>
        }
      />

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
                <Button onClick={openCreate} disabled={(sources.data?.items.length ?? 0) === 0}>
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
                            <Button variant="ghost" size="sm" onClick={() => openEdit(split)}>
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
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{editing ? t("splits.editTitle") : t("splits.createTitle")}</DialogTitle>
            <DialogDescription className="sr-only">
              {editing
                ? t("splits.editDescription", { revision: editing.revision })
                : t("splits.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
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
              <Field data-invalid={Boolean(formFields.source_id)}>
                <FieldLabel htmlFor="split-form-source">{t("splits.form.source")}</FieldLabel>
                <Select
                  value={form.sourceId}
                  disabled={Boolean(editing)}
                  onValueChange={(value) => {
                    setForm((current) => ({ ...current, sourceId: value }))
                    setSelected(new Set())
                    setAssignments({})
                    setBatteryPage(1)
                  }}
                >
                  <SelectTrigger id="split-form-source">
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
                {editing ? (
                  <FieldDescription>{t("splits.form.sourceLocked")}</FieldDescription>
                ) : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="split-method">{t("splits.form.method")}</FieldLabel>
                <Select
                  value={form.method}
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
              <div className="grid gap-4 sm:grid-cols-3">
                {(["train", "val", "test"] as const).map((partition) => (
                  <Field key={partition}>
                    <FieldLabel htmlFor={`ratio-${partition}`}>
                      {t("splits.form.ratio", { partition: t(`splits.partitions.${partition}`) })}
                    </FieldLabel>
                    <Input
                      id={`ratio-${partition}`}
                      inputMode="decimal"
                      value={form.ratios[partition]}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          ratios: { ...current.ratios, [partition]: event.target.value },
                        }))
                      }
                    />
                  </Field>
                ))}
              </div>
            ) : null}

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
                    <p className="p-3 text-sm text-muted-foreground">{t("splits.form.noMatch")}</p>
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
                      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={identity}>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submitForm} disabled={pending}>
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
