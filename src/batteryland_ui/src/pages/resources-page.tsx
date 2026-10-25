import { useMutation, useQuery } from "@tanstack/react-query"
import { DatabaseIcon, LayersIcon, SearchIcon, XIcon } from "lucide-react"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { endpoints } from "@/api/endpoints"
import type { Battery, DataSource } from "@/api/models"
import { queryKeys } from "@/api/query-client"
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state"
import { PageHeader } from "@/components/page-header"
import { PaginationControls } from "@/components/pagination-controls"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type Filters = {
  q: string
  chemistry: string
  material: string
  temperatureC: string
  nominalCapacityAh: string
}

const EMPTY_FILTERS: Filters = {
  q: "",
  chemistry: "",
  material: "",
  temperatureC: "",
  nominalCapacityAh: "",
}

function metadataValue(battery: Battery, key: string): string {
  const value = battery.metadata[key]
  return value === null || value === undefined || value === "" ? "—" : String(value)
}

function batteryParams(sourceId: string, filters: Filters, page: number, pageSize: number) {
  return {
    sourceId,
    q: filters.q.trim() || undefined,
    chemistry: filters.chemistry.trim() || undefined,
    material: filters.material.trim() || undefined,
    temperatureC: filters.temperatureC === "" ? undefined : Number(filters.temperatureC),
    nominalCapacityAh:
      filters.nominalCapacityAh === "" ? undefined : Number(filters.nominalCapacityAh),
    page,
    pageSize,
  }
}

export function ResourcesPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [sourceId, setSourceId] = useState("")
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedFiles, setSelectedFiles] = useState<
    Record<string, Pick<Battery, "file_name" | "relative_key">>
  >({})
  const [entireSource, setEntireSource] = useState(false)
  const [selectionProgress, setSelectionProgress] = useState<{
    page: number
    pages: number
  } | null>(null)
  const selectionAbort = useRef<AbortController | null>(null)
  const excludedFromWholeSource = useRef<Set<string> | null>(null)

  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources,
    queryFn: ({ signal }) => endpoints.sources.list({ page: 1, pageSize: 200 }, signal),
  })
  const sources = sourcesQuery.data?.items ?? []
  const selectedSource = sources.find((source) => source.id === sourceId) ?? null
  const batteriesQuery = useQuery({
    queryKey: queryKeys.batteries({ sourceId, filters, page, pageSize }),
    queryFn: ({ signal }) =>
      endpoints.batteries.list(batteryParams(sourceId, filters, page, pageSize), signal),
    enabled: Boolean(sourceId),
  })
  const batteries = batteriesQuery.data?.items ?? []
  const allOnPageSelected =
    batteries.length > 0 &&
    (entireSource || batteries.every((battery) => selectedIds.has(battery.id)))

  const allMatchingMutation = useMutation({
    mutationFn: async () => {
      if (!sourceId) return [] as Battery[]
      const controller = new AbortController()
      selectionAbort.current = controller
      const first = await endpoints.batteries.list(
        batteryParams(sourceId, filters, 1, 200),
        controller.signal,
      )
      const pages = Math.max(1, Math.ceil(first.total / first.page_size))
      setSelectionProgress({ page: 1, pages })
      const identities = [...first.items]
      for (let next = 2; next <= pages; next++) {
        const result = await endpoints.batteries.list(
          batteryParams(sourceId, filters, next, 200),
          controller.signal,
        )
        identities.push(...result.items)
        setSelectionProgress({ page: next, pages })
      }
      return identities
    },
    onSuccess: (identities) => {
      setSelectedIds(new Set(identities.map((battery) => battery.id)))
      setSelectedFiles(
        Object.fromEntries(
          identities.map((battery) => [
            battery.id,
            {
              file_name: battery.file_name,
              relative_key: battery.relative_key,
            },
          ]),
        ),
      )
      setEntireSource(false)
      setSelectionProgress(null)
    },
    onError: (error) => {
      if (error instanceof DOMException && error.name === "AbortError") return
      toast.error(t("workflow.dataset.selectionFailed"))
      setSelectionProgress(null)
    },
    onSettled: () => {
      selectionAbort.current = null
    },
  })

  const allSourceMutation = useMutation({
    mutationFn: async () => {
      if (!sourceId) return [] as Battery[]
      const controller = new AbortController()
      selectionAbort.current = controller
      const first = await endpoints.batteries.list(
        { sourceId, page: 1, pageSize: 200 },
        controller.signal,
      )
      const pages = Math.max(1, Math.ceil(first.total / first.page_size))
      setSelectionProgress({ page: 1, pages })
      const identities = [...first.items]
      for (let next = 2; next <= pages; next++) {
        const result = await endpoints.batteries.list(
          { sourceId, page: next, pageSize: 200 },
          controller.signal,
        )
        identities.push(...result.items)
        setSelectionProgress({ page: next, pages })
      }
      return identities
    },
    onSuccess: (identities) => {
      const excluded = excludedFromWholeSource.current
      const available = excluded
        ? identities.filter((battery) => !excluded.has(battery.id))
        : identities
      setSelectedIds(new Set(available.map((battery) => battery.id)))
      setSelectedFiles(
        Object.fromEntries(
          available.map((battery) => [
            battery.id,
            {
              file_name: battery.file_name,
              relative_key: battery.relative_key,
            },
          ]),
        ),
      )
      excludedFromWholeSource.current = null
      setEntireSource(false)
      setSelectionProgress(null)
    },
    onError: (error) => {
      if (error instanceof DOMException && error.name === "AbortError") return
      toast.error(t("workflow.dataset.selectionFailed"))
      setSelectionProgress(null)
    },
    onSettled: () => {
      selectionAbort.current = null
    },
  })

  const busySelecting = allMatchingMutation.isPending || allSourceMutation.isPending

  function cancelSelection() {
    selectionAbort.current?.abort()
  }

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFilters({ ...draftFilters })
    setPage(1)
  }

  function changeSource(source: DataSource) {
    setSourceId(source.id)
    setSelectedIds(new Set())
    setSelectedFiles({})
    setEntireSource(false)
    setPage(1)
  }

  function toggleBattery(battery: Battery, checked: boolean) {
    const id = battery.id
    if (entireSource) {
      if (!checked) {
        excludedFromWholeSource.current = new Set([id])
        allSourceMutation.mutate()
      }
      return
    }
    setEntireSource(false)
    setSelectedIds((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
    setSelectedFiles((current) => {
      const next = { ...current }
      if (checked) next[id] = { file_name: battery.file_name, relative_key: battery.relative_key }
      else delete next[id]
      return next
    })
  }

  function togglePage(checked: boolean) {
    if (entireSource) {
      if (!checked) {
        excludedFromWholeSource.current = new Set(batteries.map((battery) => battery.id))
        allSourceMutation.mutate()
      }
      return
    }
    setEntireSource(false)
    setSelectedIds((current) => {
      const next = new Set(current)
      for (const battery of batteries) {
        if (checked) next.add(battery.id)
        else next.delete(battery.id)
      }
      return next
    })
    setSelectedFiles((current) => {
      const next = { ...current }
      for (const battery of batteries) {
        if (checked)
          next[battery.id] = { file_name: battery.file_name, relative_key: battery.relative_key }
        else delete next[battery.id]
      }
      return next
    })
  }

  function beginSplit() {
    if (!selectedSource || (!entireSource && selectedIds.size === 0)) return
    sessionStorage.setItem(
      "batteryland.pending-split-selection",
      JSON.stringify({
        source_id: selectedSource.id,
        source_revision: selectedSource.revision,
        battery_ids: entireSource ? [] : [...selectedIds],
        battery_files: entireSource ? {} : selectedFiles,
        include_all_source: entireSource,
      }),
    )
    navigate("/splits?create=1")
  }

  const sourceCards = sources

  return (
    <>
      <PageHeader
        title={t("workflow.dataset.title")}
        description={t("workflow.dataset.description")}
      />

      {sourcesQuery.isLoading ? <LoadingState rows={2} /> : null}
      {sourcesQuery.error ? (
        <ErrorState error={sourcesQuery.error} onRetry={() => void sourcesQuery.refetch()} />
      ) : null}

      <section aria-labelledby="dataset-sources-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="dataset-sources-heading" className="text-sm font-semibold text-foreground">
            {t("workflow.dataset.source")}
          </h2>
          <span className="text-xs text-muted-foreground">{sourceCards.length}</span>
        </div>
        {sources.length === 0 && !sourcesQuery.isLoading ? (
          <EmptyState title={t("workflow.dataset.sourceUnavailable")} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {sources.map((source, index) => {
              const active = source.id === sourceId
              const accent = [
                "border-chart-1",
                "border-chart-2",
                "border-chart-3",
                "border-chart-4",
                "border-chart-5",
              ][index % 5]
              return (
                <button
                  key={source.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => changeSource(source)}
                  className={`rounded-lg border border-l-4 bg-card p-4 text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring ${accent} ${active ? "ring-2 ring-ring/60" : ""}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{source.name}</span>
                    {source.availability !== "available" ? (
                      <Badge variant="outline">{t("workflow.dataset.sourceUnavailable")}</Badge>
                    ) : null}
                  </span>
                  <span className="mt-2 block text-sm text-muted-foreground">
                    {t("workflow.dataset.sourceCount", { count: source.battery_count })}
                  </span>
                  <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                    {source.root_alias}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {selectedSource ? (
        <section className="flex flex-col gap-4" aria-labelledby="battery-files-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="battery-files-heading" className="text-base font-semibold">
                {selectedSource.name}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("workflow.dataset.sourceCount", { count: selectedSource.battery_count })}
              </p>
            </div>
            <Button
              variant={entireSource ? "secondary" : "outline"}
              onClick={() => {
                setSelectedIds(new Set())
                setSelectedFiles({})
                setEntireSource((value) => !value)
              }}
              disabled={selectedSource.battery_count === 0}
            >
              <DatabaseIcon data-icon="inline-start" />
              {entireSource
                ? t("workflow.dataset.clearSelection")
                : t("workflow.dataset.selectSource")}
            </Button>
          </div>

          <Card>
            <CardContent className="pt-5">
              <form className="flex flex-col gap-4" onSubmit={applyFilters}>
                <FieldGroup className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <Field className="xl:col-span-2">
                    <FieldLabel htmlFor="battery-search">{t("workflow.dataset.search")}</FieldLabel>
                    <Input
                      id="battery-search"
                      value={draftFilters.q}
                      onChange={(event) =>
                        setDraftFilters((current) => ({ ...current, q: event.target.value }))
                      }
                      placeholder={t("workflow.dataset.search")}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="battery-chemistry">
                      {t("workflow.dataset.chemistry")}
                    </FieldLabel>
                    <Input
                      id="battery-chemistry"
                      value={draftFilters.chemistry}
                      onChange={(event) =>
                        setDraftFilters((current) => ({
                          ...current,
                          chemistry: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="battery-material">
                      {t("workflow.dataset.material")}
                    </FieldLabel>
                    <Input
                      id="battery-material"
                      value={draftFilters.material}
                      onChange={(event) =>
                        setDraftFilters((current) => ({ ...current, material: event.target.value }))
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="battery-capacity">
                      {t("workflow.dataset.capacity")}
                    </FieldLabel>
                    <Input
                      id="battery-capacity"
                      inputMode="decimal"
                      type="number"
                      value={draftFilters.nominalCapacityAh}
                      onChange={(event) =>
                        setDraftFilters((current) => ({
                          ...current,
                          nominalCapacityAh: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="battery-temperature">
                      {t("workflow.dataset.temperature")}
                    </FieldLabel>
                    <Input
                      id="battery-temperature"
                      inputMode="decimal"
                      type="number"
                      value={draftFilters.temperatureC}
                      onChange={(event) =>
                        setDraftFilters((current) => ({
                          ...current,
                          temperatureC: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </FieldGroup>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" size="sm">
                    <SearchIcon data-icon="inline-start" />
                    {t("workflow.dataset.applyFilters")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDraftFilters(EMPTY_FILTERS)
                      setFilters(EMPTY_FILTERS)
                      setPage(1)
                    }}
                  >
                    <XIcon data-icon="inline-start" />
                    {t("workflow.dataset.clearFilters")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              {entireSource ? (
                <Badge variant="secondary">
                  {t("workflow.dataset.selectionSource", { count: selectedSource.battery_count })}
                </Badge>
              ) : (
                <Badge variant="secondary">
                  {t("workflow.dataset.selectionCount", { count: selectedIds.size })}
                </Badge>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={busySelecting || batteriesQuery.isLoading || !batteries.length}
                onClick={() => allMatchingMutation.mutate()}
              >
                {t("workflow.dataset.selectFiltered")}
              </Button>
              {busySelecting ? (
                <span role="status" className="text-xs text-muted-foreground">
                  {t("workflow.dataset.selecting", {
                    page: selectionProgress?.page ?? 1,
                    pages: selectionProgress?.pages ?? 1,
                  })}
                </span>
              ) : null}
              {busySelecting ? (
                <Button size="sm" variant="ghost" onClick={cancelSelection}>
                  {t("workflow.dataset.cancelSelection")}
                </Button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={selectedIds.size === 0 && !entireSource}
                onClick={() => {
                  setSelectedIds(new Set())
                  setSelectedFiles({})
                  setEntireSource(false)
                }}
              >
                {t("workflow.dataset.clearSelection")}
              </Button>
              <Button
                size="sm"
                onClick={beginSplit}
                disabled={selectedIds.size === 0 && !entireSource}
              >
                <LayersIcon data-icon="inline-start" />
                {t("workflow.dataset.createSplit")}
              </Button>
            </div>
          </div>

          {batteriesQuery.isLoading && batteriesQuery.data === undefined ? (
            <LoadingState rows={5} />
          ) : null}
          {batteriesQuery.error ? (
            <ErrorState
              error={batteriesQuery.error}
              onRetry={() => void batteriesQuery.refetch()}
            />
          ) : null}
          {batteriesQuery.data && batteries.length === 0 ? (
            <EmptyState title={t("workflow.dataset.empty")} />
          ) : null}
          {batteriesQuery.data && batteries.length > 0 ? (
            <>
              <div className="overflow-x-auto rounded-lg border bg-card">
                <Table>
                  <caption className="sr-only">{t("workflow.dataset.tableCaption")}</caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          aria-label={t("workflow.dataset.selectPage")}
                          checked={allOnPageSelected}
                          onCheckedChange={(checked) => togglePage(checked === true)}
                        />
                      </TableHead>
                      <TableHead>{t("workflow.dataset.columns.file")}</TableHead>
                      <TableHead>{t("workflow.dataset.columns.chemistry")}</TableHead>
                      <TableHead>{t("workflow.dataset.columns.material")}</TableHead>
                      <TableHead>{t("workflow.dataset.columns.temperature")}</TableHead>
                      <TableHead>{t("workflow.dataset.columns.capacity")}</TableHead>
                      <TableHead>{t("workflow.dataset.columns.availability")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batteries.map((battery) => (
                      <TableRow
                        key={battery.id}
                        data-state={selectedIds.has(battery.id) ? "selected" : undefined}
                      >
                        <TableCell>
                          <Checkbox
                            aria-label={battery.file_name}
                            checked={selectedIds.has(battery.id) || entireSource}
                            onCheckedChange={(checked) => toggleBattery(battery, checked === true)}
                          />
                        </TableCell>
                        <TableCell>
                          <div
                            className="max-w-[34rem] truncate font-medium"
                            title={battery.relative_key}
                          >
                            {battery.file_name}
                          </div>
                          <div className="max-w-[34rem] truncate font-mono text-xs text-muted-foreground">
                            {battery.relative_key}
                          </div>
                        </TableCell>
                        <TableCell>{metadataValue(battery, "chemistry")}</TableCell>
                        <TableCell>{metadataValue(battery, "material")}</TableCell>
                        <TableCell>{metadataValue(battery, "temperature_c")}</TableCell>
                        <TableCell>{metadataValue(battery, "nominal_capacity_ah")}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{battery.availability}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {batteriesQuery.data ? (
                <PaginationControls
                  page={page}
                  pageSize={pageSize}
                  total={batteriesQuery.data.total}
                  onPageChange={setPage}
                  onPageSizeChange={(size) => {
                    setPageSize(size)
                    setPage(1)
                  }}
                />
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
    </>
  )
}
