import { FileUpIcon, PlusIcon, RefreshCwIcon, SearchIcon } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { errorMessage, fieldErrors } from "@/api/client"
import { endpoints } from "@/api/endpoints"
import type { Battery, DataSource, ImportReport } from "@/api/models"
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state"
import { PageHeader } from "@/components/page-header"
import { PaginationControls } from "@/components/pagination-controls"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { enumLabel, formatDate, formatMetric } from "@/lib/format"

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
  const [importDialog, setImportDialog] = useState(false)
  const [importSource, setImportSource] = useState("")
  const [manifest, setManifest] = useState<ManifestEntry[] | null>(null)
  const [manifestName, setManifestName] = useState("")
  const [manifestError, setManifestError] = useState<string | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [pending, setPending] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

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

  const sourceItems = sources.data?.items ?? []
  const sourceNames = useMemo(
    () => Object.fromEntries(sourceItems.map((source) => [source.id, source.name])),
    [sourceItems],
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
      await endpoints.sources.create({ name: sourceName.trim(), root_alias: rootAlias.trim() })
      toast.success(t("resources.messages.sourceCreated"))
      setSourceDialog(false)
      setSourceName("")
      setRootAlias("")
      setSourcePage(1)
      sources.refresh()
    } catch (error) {
      setSourceError(errorMessage(error))
      setSourceFields(fieldErrors(error))
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
        description={t("resources.description")}
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
                <DialogDescription>{t("resources.sourceDialogDescription")}</DialogDescription>
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
                <Field data-invalid={Boolean(sourceFields.root_alias)}>
                  <FieldLabel htmlFor="source-alias">{t("resources.alias")}</FieldLabel>
                  <Input
                    id="source-alias"
                    value={rootAlias}
                    placeholder={t("resources.aliasPlaceholder")}
                    aria-invalid={Boolean(sourceFields.root_alias)}
                    onChange={(event) => setRootAlias(event.target.value)}
                  />
                  <FieldDescription>{t("resources.aliasExample")}</FieldDescription>
                </Field>
                {sourceError ? <FieldError>{sourceError}</FieldError> : null}
              </FieldGroup>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSourceDialog(false)}>
                  {t("common.cancel")}
                </Button>
                <Button onClick={createSource} disabled={pending}>
                  {pending ? t("resources.registering") : t("resources.register")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("resources.sourcesTitle")}</CardTitle>
          <CardDescription>{t("resources.sourcesDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {sources.loading && sources.data === undefined ? <LoadingState rows={2} /> : null}
          {sources.error ? <ErrorState error={sources.error} onRetry={sources.refresh} /> : null}
          {sources.data && sourceItems.length === 0 ? (
            <EmptyState
              title={t("resources.emptySourcesTitle")}
              description={t("resources.emptySourcesDescription")}
            />
          ) : null}
          {sourceItems.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("resources.columns.name")}</TableHead>
                  <TableHead>{t("resources.columns.alias")}</TableHead>
                  <TableHead>{t("resources.columns.availability")}</TableHead>
                  <TableHead>{t("resources.columns.revision")}</TableHead>
                  <TableHead>{t("resources.columns.createdAt")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sourceItems.map((source: DataSource) => (
                  <TableRow key={source.id}>
                    <TableCell className="font-medium">{source.name}</TableCell>
                    <TableCell className="font-mono text-xs">{source.root_alias}</TableCell>
                    <TableCell>{enumLabel(source.availability, "availability")}</TableCell>
                    <TableCell>{source.revision}</TableCell>
                    <TableCell>{formatDate(source.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
            <CardDescription>{t("resources.batteriesDescription")}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => batteries.refresh()}>
              <RefreshCwIcon data-icon="inline-start" />
              {t("common.refresh")}
            </Button>
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
                <Button disabled={sourceItems.length === 0}>
                  <FileUpIcon data-icon="inline-start" />
                  {t("resources.importManifest")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("resources.manifestTitle")}</DialogTitle>
                  <DialogDescription>{t("resources.manifestDescription")}</DialogDescription>
                </DialogHeader>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="manifest-source">{t("resources.targetSource")}</FieldLabel>
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
            <Field>
              <FieldLabel htmlFor="filter-chemistry">{t("resources.filterChemistry")}</FieldLabel>
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
                  setDraftFilters((current) => ({ ...current, temperatureC: event.target.value }))
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
