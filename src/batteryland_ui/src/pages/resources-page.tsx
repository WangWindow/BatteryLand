import { FileUpIcon, FolderOpenIcon, PlusIcon, RefreshCwIcon, SearchIcon } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { errorMessage, fieldErrors } from "@/api/client"
import { endpoints } from "@/api/endpoints"
import type { Battery, DataSource, DiscoveredBatteryFile, ImportReport } from "@/api/models"
import { AdvancedSection } from "@/components/advanced-section"
import { ChoiceField } from "@/components/choice-field"
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
import { useApiQuery } from "@/hooks/use-api-query"
import { enumLabel, formatBytes, formatMetric } from "@/lib/format"

type BatteryFilters = {
  sourceId: string
  q: string
  chemistry: string
  material: string
  temperatureC: string
  nominalCapacityAh: string
}

const EMPTY_FILTERS: BatteryFilters = {
  sourceId: "",
  q: "",
  chemistry: "",
  material: "",
  temperatureC: "",
  nominalCapacityAh: "",
}

const SOURCE_ACCENTS = [
  "border-l-sky-500",
  "border-l-emerald-500",
  "border-l-amber-500",
  "border-l-violet-500",
  "border-l-rose-500",
  "border-l-cyan-500",
] as const

function metadataValue(battery: Battery, key: string): string {
  const value = battery.metadata?.[key]
  if (value === null || value === undefined || value === "") {
    return "—"
  }
  return String(value)
}

type ManifestEntry = { file_name: string; metadata?: Record<string, unknown> }

type ManifestMessages = {
  invalidJson: (message: string) => string
  notArray: string
  missingFileName: (index: number) => string
  invalidMetadata: (index: number) => string
}

function parseManifest(text: string, messages: ManifestMessages): ManifestEntry[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(messages.invalidJson(error instanceof Error ? error.message : ""))
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && "batteries" in parsed
      ? (parsed as { batteries: unknown }).batteries
      : null
  if (!Array.isArray(list)) {
    throw new Error(messages.notArray)
  }
  return list.map((item, index) => {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as ManifestEntry).file_name !== "string"
    ) {
      throw new Error(messages.missingFileName(index + 1))
    }
    const entry = item as ManifestEntry
    if (
      entry.metadata !== undefined &&
      (typeof entry.metadata !== "object" || entry.metadata === null)
    ) {
      throw new Error(messages.invalidMetadata(index + 1))
    }
    return entry
  })
}

export function ResourcesPage() {
  const { t } = useTranslation()
  const [sourcePage, setSourcePage] = useState(1)
  const [batteryPage, setBatteryPage] = useState(1)
  const [batteryPageSize, setBatteryPageSize] = useState(50)
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [sourceDialog, setSourceDialog] = useState(false)
  const [sourceName, setSourceName] = useState("")
  const [rootAlias, setRootAlias] = useState("")
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [sourceFields, setSourceFields] = useState<Record<string, string>>({})
  const [fileBrowserSource, setFileBrowserSource] = useState<DataSource | null>(null)
  const [filePage, setFilePage] = useState(1)
  const [fileQuery, setFileQuery] = useState("")
  const [selectedFiles, setSelectedFiles] = useState<Record<string, DiscoveredBatteryFile>>({})
  const [fileError, setFileError] = useState<string | null>(null)
  const [importDialog, setImportDialog] = useState(false)
  const [importSource, setImportSource] = useState("")
  const [manifest, setManifest] = useState<ManifestEntry[] | null>(null)
  const [manifestName, setManifestName] = useState("")
  const [manifestError, setManifestError] = useState<string | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [pending, setPending] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const sourceOptions = useApiQuery((signal) => endpoints.sources.options(signal), [])

  const sources = useApiQuery(
    (signal) => endpoints.sources.list({ page: sourcePage, pageSize: 100 }, signal),
    [sourcePage],
  )
  const batteries = useApiQuery(
    (signal) =>
      endpoints.batteries.list(
        {
          page: batteryPage,
          pageSize: batteryPageSize,
          sourceId: filters.sourceId || undefined,
          q: filters.q || undefined,
          chemistry: filters.chemistry || undefined,
          material: filters.material || undefined,
          temperatureC: filters.temperatureC ? Number(filters.temperatureC) : undefined,
          nominalCapacityAh: filters.nominalCapacityAh
            ? Number(filters.nominalCapacityAh)
            : undefined,
        },
        signal,
      ),
    [batteryPage, batteryPageSize, filters],
  )
  const availableFiles = useApiQuery(
    (signal) =>
      fileBrowserSource
        ? endpoints.sources.files(
            fileBrowserSource.id,
            { page: filePage, pageSize: 50, q: fileQuery || undefined },
            signal,
          )
        : Promise.resolve(null),
    [fileBrowserSource?.id, filePage, fileQuery],
    { enabled: Boolean(fileBrowserSource) },
  )

  const sourceItems = sources.data?.items ?? []
  const sourceNames = useMemo(
    () => Object.fromEntries(sourceItems.map((source) => [source.id, source.name])),
    [sourceItems],
  )
  const optionsByAlias = useMemo(
    () =>
      Object.fromEntries((sourceOptions.data ?? []).map((option) => [option.root_alias, option])),
    [sourceOptions.data],
  )

  async function createSource() {
    setSourceError(null)
    setSourceFields({})
    if (!sourceName.trim() || !rootAlias.trim()) {
      setSourceError(t("resources.messages.required"))
      return
    }
    setPending(true)
    try {
      const created = await endpoints.sources.create({
        name: sourceName.trim(),
        root_alias: rootAlias.trim(),
      })
      toast.success(t("resources.messages.sourceCreated"))
      setSourceDialog(false)
      setSourceName("")
      setRootAlias("")
      setSourcePage(1)
      sources.refresh()
      openFileBrowser(created)
    } catch (error) {
      setSourceError(errorMessage(error))
      setSourceFields(fieldErrors(error))
    } finally {
      setPending(false)
    }
  }

  function openFileBrowser(source: DataSource) {
    setFileBrowserSource(source)
    setFilePage(1)
    setFileQuery("")
    setSelectedFiles({})
    setFileError(null)
  }

  function toggleDiscoveredFile(file: DiscoveredBatteryFile, checked: boolean) {
    setSelectedFiles((current) => {
      const next = { ...current }
      if (checked) {
        next[file.relative_key] = file
      } else {
        delete next[file.relative_key]
      }
      return next
    })
  }

  function showBatteriesForSource(sourceId: string) {
    const next = { ...EMPTY_FILTERS, sourceId }
    setDraftFilters(next)
    setFilters(next)
    setBatteryPage(1)
  }

  async function importDiscoveredFiles() {
    if (!fileBrowserSource || Object.keys(selectedFiles).length === 0) {
      return
    }
    setPending(true)
    setFileError(null)
    try {
      const result = await endpoints.sources.importBatteries(
        fileBrowserSource.id,
        Object.values(selectedFiles).map((file) => ({
          file_name: file.file_name,
          relative_key: file.relative_key,
        })),
      )
      toast.success(
        t("resources.messages.importFinished", {
          imported: result.imported,
          existing: result.existing,
        }),
      )
      setFileBrowserSource(null)
      setSelectedFiles({})
      batteries.refresh()
      sources.refresh()
    } catch (error) {
      setFileError(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  async function chooseManifest(file: File) {
    setManifestError(null)
    setReport(null)
    setManifestName(file.name)
    try {
      setManifest(
        parseManifest(await file.text(), {
          invalidJson: (message) => t("resources.messages.invalidJson", { message }),
          notArray: t("resources.messages.manifestNotArray"),
          missingFileName: (index) => t("resources.messages.missingFileName", { index }),
          invalidMetadata: (index) => t("resources.messages.invalidMetadata", { index }),
        }),
      )
    } catch (error) {
      setManifest(null)
      setManifestError(errorMessage(error))
    }
  }

  async function importManifest() {
    if (!importSource) {
      setManifestError(t("resources.messages.chooseSource"))
      return
    }
    if (!manifest) {
      setManifestError(t("resources.messages.invalidManifest"))
      return
    }
    setPending(true)
    setManifestError(null)
    try {
      const result = await endpoints.sources.importBatteries(importSource, manifest)
      setReport(result)
      toast.success(
        t("resources.messages.importFinished", {
          imported: result.imported,
          existing: result.existing,
        }),
      )
      batteries.refresh()
    } catch (error) {
      setManifestError(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  function applyFilters() {
    setBatteryPage(1)
    setFilters({ ...draftFilters })
  }

  function resetFilters() {
    setDraftFilters(EMPTY_FILTERS)
    setFilters(EMPTY_FILTERS)
    setBatteryPage(1)
  }

  return (
    <>
      <PageHeader
        title={t("resources.title")}
        actions={
          <Dialog open={sourceDialog} onOpenChange={setSourceDialog}>
            <DialogTrigger asChild>
              <Button>
                <PlusIcon data-icon="inline-start" />
                {t("resources.addSource")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("resources.sourceDialogTitle")}</DialogTitle>
                <DialogDescription className="sr-only">
                  {t("resources.sourceDialogDescription")}
                </DialogDescription>
              </DialogHeader>
              <FieldGroup>
                <Field data-invalid={Boolean(sourceFields.name)}>
                  <FieldLabel htmlFor="source-name">{t("resources.name")}</FieldLabel>
                  <Input
                    id="source-name"
                    value={sourceName}
                    aria-invalid={Boolean(sourceFields.name)}
                    onChange={(event) => setSourceName(event.target.value)}
                  />
                  <FieldError>{sourceFields.name}</FieldError>
                </Field>
                <ChoiceField
                  id="source-alias"
                  label={t("resources.alias")}
                  value={rootAlias}
                  options={(sourceOptions.data ?? []).map((option) => ({
                    value: option.root_alias,
                    label: `${option.display_name} · ${option.root_alias} · ${t("resources.availableFileCount", { count: option.file_count })}`,
                  }))}
                  onChange={setRootAlias}
                  placeholder={t("resources.chooseSource")}
                />
                {sourceOptions.error ? (
                  <ErrorState error={sourceOptions.error} onRetry={sourceOptions.refresh} />
                ) : null}
                {sourceOptions.data?.length === 0 ? (
                  <FieldError>{t("workbench.noSourceOptions")}</FieldError>
                ) : null}
                {sourceError ? <FieldError>{sourceError}</FieldError> : null}
              </FieldGroup>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSourceDialog(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={createSource}
                  disabled={pending || sourceOptions.loading || sourceOptions.data?.length === 0}
                >
                  {pending ? t("resources.registering") : t("resources.register")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <Dialog
        open={Boolean(fileBrowserSource)}
        onOpenChange={(open) => {
          if (!open) {
            setFileBrowserSource(null)
            setSelectedFiles({})
            setFileError(null)
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {fileBrowserSource
                ? t("resources.browseTitle", { name: fileBrowserSource.name })
                : t("resources.browseTitle", { name: "" })}
            </DialogTitle>
            <DialogDescription>
              {fileBrowserSource
                ? t("resources.browseDescription", {
                    folder:
                      optionsByAlias[fileBrowserSource.root_alias]?.display_name ??
                      fileBrowserSource.root_alias,
                    alias: fileBrowserSource.root_alias,
                  })
                : null}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="source-file-search">{t("resources.fileSearch")}</FieldLabel>
              <Input
                id="source-file-search"
                value={fileQuery}
                placeholder={t("resources.fileSearchPlaceholder")}
                onChange={(event) => {
                  setFileQuery(event.target.value)
                  setFilePage(1)
                }}
              />
            </Field>
            <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>
                {t("resources.availableFileCount", {
                  count: availableFiles.data?.total ?? 0,
                })}
              </span>
              <span>
                {t("resources.selectedFileCount", { count: Object.keys(selectedFiles).length })}
              </span>
            </div>
            {availableFiles.loading && availableFiles.data === undefined ? (
              <LoadingState rows={4} />
            ) : null}
            {availableFiles.error ? (
              <ErrorState error={availableFiles.error} onRetry={availableFiles.refresh} />
            ) : null}
            {fileError ? <FieldError>{fileError}</FieldError> : null}
            {availableFiles.data && availableFiles.data.items.length === 0 ? (
              <EmptyState
                title={t("resources.emptyFilesTitle")}
                description={t("resources.emptyFilesDescription")}
              />
            ) : null}
            {availableFiles.data && availableFiles.data.items.length > 0 ? (
              <>
                <div className="max-h-[50vh] overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10" />
                        <TableHead>{t("resources.columns.fileName")}</TableHead>
                        <TableHead>{t("resources.relativePath")}</TableHead>
                        <TableHead className="text-right">{t("resources.fileSize")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {availableFiles.data.items.map((file) => (
                        <TableRow key={file.relative_key}>
                          <TableCell>
                            <Checkbox
                              aria-label={t("resources.selectFile", { name: file.file_name })}
                              checked={Boolean(selectedFiles[file.relative_key])}
                              disabled={!file.importable}
                              onCheckedChange={(checked) =>
                                toggleDiscoveredFile(file, checked === true)
                              }
                            />
                          </TableCell>
                          <TableCell className="font-medium">{file.file_name}</TableCell>
                          <TableCell className="max-w-80 truncate font-mono text-xs text-muted-foreground">
                            {file.relative_key}
                            {!file.importable ? (
                              <span className="ml-2 text-destructive">
                                {t("resources.duplicateFileName")}
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatBytes(file.size_bytes)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <PaginationControls
                  page={filePage}
                  pageSize={50}
                  total={availableFiles.data.total}
                  onPageChange={setFilePage}
                />
              </>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFileBrowserSource(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={importDiscoveredFiles}
              disabled={pending || Object.keys(selectedFiles).length === 0}
            >
              <FileUpIcon data-icon="inline-start" />
              {pending
                ? t("resources.importing")
                : t("resources.importSelected", { count: Object.keys(selectedFiles).length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>{t("resources.sourcesTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("resources.sourceRootHint")}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {sources.loading && sources.data === undefined ? <LoadingState rows={2} /> : null}
          {sources.error ? <ErrorState error={sources.error} onRetry={sources.refresh} /> : null}
          {sourceOptions.error ? (
            <ErrorState error={sourceOptions.error} onRetry={sourceOptions.refresh} />
          ) : null}
          {sources.data && sourceItems.length === 0 ? (
            <EmptyState
              title={t("resources.emptySourcesTitle")}
              description={t("resources.emptySourcesDescription")}
            />
          ) : null}
          {sourceItems.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {sourceItems.map((source: DataSource, index) => {
                const option = optionsByAlias[source.root_alias]
                const selected = filters.sourceId === source.id
                return (
                  <Card
                    key={source.id}
                    className={`border-l-4 ${SOURCE_ACCENTS[index % SOURCE_ACCENTS.length]} ${selected ? "ring-1 ring-primary" : ""}`}
                  >
                    <CardContent className="flex h-full flex-col gap-3 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate font-medium">{source.name}</h3>
                          <p className="truncate text-sm text-muted-foreground">
                            {option?.display_name ?? source.root_alias}
                          </p>
                        </div>
                        <Badge
                          variant={source.availability === "available" ? "secondary" : "outline"}
                        >
                          {enumLabel(source.availability, "availability")}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="truncate font-mono">{source.root_alias}</span>
                        <span className="shrink-0">
                          {t("resources.availableFileCount", { count: option?.file_count ?? 0 })}
                        </span>
                      </div>
                      <div className="mt-auto flex flex-wrap gap-2">
                        <Button
                          variant={selected ? "default" : "outline"}
                          size="sm"
                          onClick={() => showBatteriesForSource(source.id)}
                        >
                          {t("resources.viewBatteries")}
                        </Button>
                        <Button size="sm" onClick={() => openFileBrowser(source)}>
                          <FolderOpenIcon data-icon="inline-start" />
                          {t("resources.browseFolder")}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          ) : null}
          {sources.data && sources.data.total > 100 ? (
            <PaginationControls
              page={sourcePage}
              pageSize={100}
              total={sources.data.total}
              onPageChange={setSourcePage}
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>{t("resources.batteriesTitle")}</CardTitle>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => batteries.refresh()}>
              <RefreshCwIcon data-icon="inline-start" />
              {t("common.refresh")}
            </Button>
            <AdvancedSection label={t("resources.advancedImport")}>
              <Dialog
                open={importDialog}
                onOpenChange={(open) => {
                  setImportDialog(open)
                  if (!open) {
                    setReport(null)
                    setManifest(null)
                    setManifestError(null)
                    setManifestName("")
                    if (fileRef.current) {
                      fileRef.current.value = ""
                    }
                  }
                }}
              >
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={sourceItems.length === 0}>
                    <FileUpIcon data-icon="inline-start" />
                    {t("resources.importManifest")}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t("resources.manifestTitle")}</DialogTitle>
                    <DialogDescription className="sr-only">
                      {t("resources.manifestDescription")}
                    </DialogDescription>
                  </DialogHeader>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="manifest-source">
                        {t("resources.targetSource")}
                      </FieldLabel>
                      <Select value={importSource} onValueChange={setImportSource}>
                        <SelectTrigger id="manifest-source">
                          <SelectValue placeholder={t("resources.chooseSource")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {sourceItems.map((source) => (
                              <SelectItem key={source.id} value={source.id}>
                                {source.name} · {source.root_alias}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="manifest-file">{t("resources.manifestFile")}</FieldLabel>
                      <Input
                        id="manifest-file"
                        ref={fileRef}
                        type="file"
                        accept="application/json,.json"
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          if (file) {
                            void chooseManifest(file)
                          }
                        }}
                      />
                      <FieldDescription>
                        {manifestName
                          ? t("resources.manifestSummary", {
                              name: manifestName,
                              count: manifest?.length ?? 0,
                            })
                          : t("resources.chooseManifest")}
                      </FieldDescription>
                    </Field>
                    {manifestError ? <FieldError>{manifestError}</FieldError> : null}
                    {report ? (
                      <div className="rounded-md border bg-muted/40 p-3 text-sm">
                        <p>
                          {t("resources.importReport", {
                            imported: report.imported,
                            existing: report.existing,
                            errors: report.errors.length,
                          })}
                        </p>
                        {report.errors.length > 0 ? (
                          <ul className="mt-1 list-disc pl-5 text-destructive">
                            {report.errors.slice(0, 10).map((item, index) => (
                              <li key={index}>{JSON.stringify(item)}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </FieldGroup>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setImportDialog(false)}>
                      {t("common.close")}
                    </Button>
                    <Button onClick={importManifest} disabled={pending || !manifest}>
                      {pending ? t("resources.importing") : t("resources.startImport")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </AdvancedSection>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault()
              applyFilters()
            }}
          >
            <Field>
              <FieldLabel htmlFor="filter-source">{t("resources.filterSource")}</FieldLabel>
              <Select
                value={draftFilters.sourceId || "all"}
                onValueChange={(value) =>
                  setDraftFilters((current) => ({
                    ...current,
                    sourceId: value === "all" ? "" : value,
                  }))
                }
              >
                <SelectTrigger id="filter-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">{t("common.allSources")}</SelectItem>
                    {sourceItems.map((source) => (
                      <SelectItem key={source.id} value={source.id}>
                        {source.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="filter-q">{t("resources.filterFileName")}</FieldLabel>
              <Input
                id="filter-q"
                value={draftFilters.q}
                placeholder={t("resources.filterFileNamePlaceholder")}
                onChange={(event) =>
                  setDraftFilters((current) => ({ ...current, q: event.target.value }))
                }
              />
            </Field>
            <AdvancedSection
              label={t("workbench.moreFilters")}
              className="sm:col-span-2 lg:col-span-4"
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field>
                  <FieldLabel htmlFor="filter-chemistry">
                    {t("resources.filterChemistry")}
                  </FieldLabel>
                  <Input
                    id="filter-chemistry"
                    value={draftFilters.chemistry}
                    onChange={(event) =>
                      setDraftFilters((current) => ({ ...current, chemistry: event.target.value }))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="filter-material">{t("resources.filterMaterial")}</FieldLabel>
                  <Input
                    id="filter-material"
                    value={draftFilters.material}
                    onChange={(event) =>
                      setDraftFilters((current) => ({ ...current, material: event.target.value }))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="filter-temperature">
                    {t("resources.filterTemperature")}
                  </FieldLabel>
                  <Input
                    id="filter-temperature"
                    inputMode="decimal"
                    value={draftFilters.temperatureC}
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        temperatureC: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="filter-capacity">{t("resources.filterCapacity")}</FieldLabel>
                  <Input
                    id="filter-capacity"
                    inputMode="decimal"
                    value={draftFilters.nominalCapacityAh}
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        nominalCapacityAh: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
            </AdvancedSection>
            <div className="flex items-end gap-2 sm:col-span-2">
              <Button type="submit">
                <SearchIcon data-icon="inline-start" />
                {t("resources.search")}
              </Button>
              <Button type="button" variant="outline" onClick={resetFilters}>
                {t("resources.reset")}
              </Button>
            </div>
          </form>

          {batteries.loading && batteries.data === undefined ? <LoadingState rows={5} /> : null}
          {batteries.error ? (
            <ErrorState error={batteries.error} onRetry={batteries.refresh} />
          ) : null}
          {batteries.data && batteries.data.items.length === 0 ? (
            <EmptyState
              title={t("resources.emptyBatteriesTitle")}
              description={t("resources.emptyBatteriesDescription")}
              action={
                <Button variant="outline" onClick={resetFilters}>
                  {t("resources.clearFilters")}
                </Button>
              }
            />
          ) : null}
          {batteries.data && batteries.data.items.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("resources.columns.fileName")}</TableHead>
                      <TableHead>{t("resources.columns.source")}</TableHead>
                      <TableHead>{t("resources.columns.chemistry")}</TableHead>
                      <TableHead>{t("resources.columns.material")}</TableHead>
                      <TableHead>{t("resources.columns.temperature")}</TableHead>
                      <TableHead>{t("resources.columns.capacity")}</TableHead>
                      <TableHead>{t("resources.columns.availability")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batteries.data.items.map((battery) => (
                      <TableRow key={battery.id}>
                        <TableCell className="max-w-64 truncate font-mono text-xs">
                          {battery.file_name}
                        </TableCell>
                        <TableCell>{sourceNames[battery.source_id] ?? battery.source_id}</TableCell>
                        <TableCell>{metadataValue(battery, "chemistry")}</TableCell>
                        <TableCell>{metadataValue(battery, "material")}</TableCell>
                        <TableCell>
                          {formatMetric(
                            typeof battery.metadata?.temperature_c === "number"
                              ? battery.metadata?.temperature_c
                              : null,
                            "℃",
                          )}
                        </TableCell>
                        <TableCell>
                          {formatMetric(
                            typeof battery.metadata?.nominal_capacity_ah === "number"
                              ? battery.metadata?.nominal_capacity_ah
                              : null,
                            "Ah",
                          )}
                        </TableCell>
                        <TableCell>{enumLabel(battery.availability, "availability")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <PaginationControls
                page={batteryPage}
                pageSize={batteryPageSize}
                total={batteries.data.total}
                onPageChange={setBatteryPage}
                onPageSizeChange={(size) => {
                  setBatteryPageSize(size)
                  setBatteryPage(1)
                }}
              />
            </>
          ) : null}
        </CardContent>
      </Card>
    </>
  )
}
