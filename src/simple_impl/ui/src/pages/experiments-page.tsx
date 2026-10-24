import {
  CopyIcon,
  DownloadIcon,
  FileUpIcon,
  FlaskConicalIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  StopCircleIcon,
  Trash2Icon,
} from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { toast } from "sonner"

import { errorMessage } from "@/api/client"
import { endpoints } from "@/api/endpoints"
import type { Experiment } from "@/api/models"
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state"
import { PageHeader } from "@/components/page-header"
import { PaginationControls } from "@/components/pagination-controls"
import { StatusBadge } from "@/components/status-badge"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { enumLabel, formatDate, shortId } from "@/lib/format"
import { ExperimentFormDialog } from "@/pages/experiment-form-dialog"

const STATES = [
  "draft",
  "queued",
  "starting",
  "running",
  "stopping",
  "stopped",
  "succeeded",
  "failed",
  "cancelled",
  "needs_reconciliation",
]

const ACTIVE_STATES = new Set(["starting", "running", "stopping", "needs_reconciliation"])
const STOPPABLE_STATES = new Set(["queued", "starting", "running"])

export function ExperimentsPage() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [draftQuery, setDraftQuery] = useState("")
  const [query, setQuery] = useState("")
  const [state, setState] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Experiment | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Experiment | null>(null)
  const [pending, setPending] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importName, setImportName] = useState("")
  const [importKind, setImportKind] = useState("train")
  const [importBindings, setImportBindings] = useState("{}")
  const [importFile, setImportFile] = useState<File | null>(null)

  const experiments = useApiQuery(
    (signal) =>
      endpoints.experiments.list(
        {
          page,
          pageSize,
          q: query || undefined,
          state: state || undefined,
        },
        signal,
      ),
    [page, pageSize, query, state],
  )

  const items = experiments.data?.items ?? []
  const drafts = items.filter((item) => item.state === "draft")
  const selectedDrafts = [...selected].filter((identity) =>
    drafts.some((item) => item.id === identity),
  )

  async function enqueue(ids: string[]) {
    if (ids.length === 0) {
      toast.error(t("experiments.messages.selectDrafts"))
      return
    }
    setPending(true)
    try {
      await endpoints.experiments.queue(ids)
      toast.success(t("experiments.messages.submitted", { count: ids.length }))
      setSelected(new Set())
      experiments.refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  async function stop(experiment: Experiment) {
    setPending(true)
    try {
      const updated = await endpoints.experiments.stop(experiment.id)
      toast.success(
        t("experiments.messages.stopAccepted", { state: enumLabel(updated.state, "state") }),
      )
      experiments.refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  async function copy(experiment: Experiment) {
    setPending(true)
    try {
      const copied = await endpoints.experiments.copy(experiment.id)
      toast.success(t("experiments.messages.copied", { name: copied.name }))
      experiments.refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  async function validate(experiment: Experiment) {
    setPending(true)
    try {
      const result = await endpoints.experiments.validate(experiment.id)
      if (result.valid) {
        toast.success(t("experiments.messages.validationPassed"))
      } else {
        toast.error(
          result.errors[0]?.message?.toString() ?? t("experiments.messages.validationFailed"),
        )
      }
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  async function remove() {
    if (!deleteTarget) {
      return
    }
    setPending(true)
    try {
      await endpoints.experiments.remove(deleteTarget.id)
      toast.success(t("experiments.messages.deleted"))
      setDeleteTarget(null)
      experiments.refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  async function importExperiment() {
    if (!importName.trim() || !importFile) {
      toast.error(t("experiments.messages.importRequired"))
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(importBindings)
    } catch {
      toast.error(t("experiments.messages.bindingsObject"))
      return
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      toast.error(t("experiments.messages.bindingsObject"))
      return
    }
    setPending(true)
    try {
      await endpoints.experiments.import(
        importName.trim(),
        importKind,
        JSON.stringify(parsed),
        importFile,
      )
      toast.success(t("experiments.messages.imported"))
      setImportOpen(false)
      setImportName("")
      setImportBindings("{}")
      setImportFile(null)
      experiments.refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <PageHeader
        title={t("experiments.title")}
        description={t("experiments.description")}
        actions={
          <>
            <Dialog open={importOpen} onOpenChange={setImportOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <FileUpIcon data-icon="inline-start" />
                  {t("experiments.importExperiment")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("experiments.importTitle")}</DialogTitle>
                  <DialogDescription>{t("experiments.importDescription")}</DialogDescription>
                </DialogHeader>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="experiment-import-name">
                      {t("experiments.importName")}
                    </FieldLabel>
                    <Input
                      id="experiment-import-name"
                      value={importName}
                      onChange={(event) => setImportName(event.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="experiment-import-kind">
                      {t("experiments.kind")}
                    </FieldLabel>
                    <Select value={importKind} onValueChange={setImportKind}>
                      <SelectTrigger id="experiment-import-kind">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="train">{t("experiments.kindTrain")}</SelectItem>
                          <SelectItem value="evaluate">{t("experiments.kindEvaluate")}</SelectItem>
                          <SelectItem value="transfer">{t("experiments.kindTransfer")}</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="experiment-import-bindings">
                      {t("experiments.importBindings")}
                    </FieldLabel>
                    <Input
                      id="experiment-import-bindings"
                      value={importBindings}
                      className="font-mono text-xs"
                      onChange={(event) => setImportBindings(event.target.value)}
                    />
                    <FieldDescription>{t("experiments.importBindingsHint")}</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="experiment-import-file">
                      {t("experiments.importFile")}
                    </FieldLabel>
                    <Input
                      id="experiment-import-file"
                      type="file"
                      accept=".yaml,.yml,.json,application/json,application/yaml"
                      onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                    />
                  </Field>
                </FieldGroup>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setImportOpen(false)}>
                    {t("common.cancel")}
                  </Button>
                  <Button onClick={importExperiment} disabled={pending || !importFile}>
                    {pending ? t("common.uploading") : t("experiments.importDraft")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
            >
              <PlusIcon data-icon="inline-start" />
              {t("experiments.newExperiment")}
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("experiments.listTitle")}</CardTitle>
          <CardDescription>{t("experiments.listDescription")}</CardDescription>
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
            <Field className="w-64">
              <FieldLabel htmlFor="experiment-q">{t("experiments.nameFilter")}</FieldLabel>
              <Input
                id="experiment-q"
                value={draftQuery}
                onChange={(event) => setDraftQuery(event.target.value)}
              />
            </Field>
            <Field className="w-44">
              <FieldLabel htmlFor="experiment-state">{t("experiments.stateFilter")}</FieldLabel>
              <Select
                value={state || "all"}
                onValueChange={(value) => {
                  setState(value === "all" ? "" : value)
                  setPage(1)
                }}
              >
                <SelectTrigger id="experiment-state">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">{t("experiments.allStates")}</SelectItem>
                    {STATES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`common.state.${value}`, { defaultValue: value })}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Button type="submit" variant="outline">
              <SearchIcon data-icon="inline-start" />
              {t("experiments.search")}
            </Button>
            <Button
              type="button"
              onClick={() => void enqueue(selectedDrafts)}
              disabled={pending || selectedDrafts.length === 0}
            >
              <FlaskConicalIcon data-icon="inline-start" />
              {t("experiments.submitSelected", { count: selectedDrafts.length })}
            </Button>
          </form>

          {experiments.loading && experiments.data === undefined ? <LoadingState rows={5} /> : null}
          {experiments.error ? (
            <ErrorState error={experiments.error} onRetry={experiments.refresh} />
          ) : null}
          {experiments.data && experiments.data.items.length === 0 ? (
            <EmptyState
              title={t("experiments.emptyTitle")}
              description={t("experiments.emptyDescription")}
              action={
                <Button
                  onClick={() => {
                    setEditing(null)
                    setFormOpen(true)
                  }}
                >
                  {t("experiments.newExperiment")}
                </Button>
              }
            />
          ) : null}
          {experiments.data && experiments.data.items.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          aria-label={t("experiments.selectPageDrafts")}
                          checked={
                            drafts.length > 0 && drafts.every((item) => selected.has(item.id))
                          }
                          onCheckedChange={(checked) =>
                            setSelected(
                              checked ? new Set(drafts.map((item) => item.id)) : new Set(),
                            )
                          }
                        />
                      </TableHead>
                      <TableHead>{t("experiments.columns.name")}</TableHead>
                      <TableHead>{t("experiments.columns.state")}</TableHead>
                      <TableHead>{t("experiments.columns.device")}</TableHead>
                      <TableHead>{t("experiments.columns.collection")}</TableHead>
                      <TableHead>{t("experiments.columns.revision")}</TableHead>
                      <TableHead>{t("experiments.columns.createdAt")}</TableHead>
                      <TableHead className="text-right">
                        {t("experiments.columns.actions")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((experiment) => (
                      <TableRow key={experiment.id}>
                        <TableCell>
                          <Checkbox
                            aria-label={t("experiments.selectExperiment", {
                              name: experiment.name,
                            })}
                            disabled={experiment.state !== "draft"}
                            checked={selected.has(experiment.id)}
                            onCheckedChange={(checked) =>
                              setSelected((current) => {
                                const next = new Set(current)
                                if (checked) {
                                  next.add(experiment.id)
                                } else {
                                  next.delete(experiment.id)
                                }
                                return next
                              })
                            }
                          />
                        </TableCell>
                        <TableCell className="max-w-64">
                          <Link
                            to={`/experiments/${experiment.id}`}
                            className="block truncate font-medium text-primary hover:underline"
                          >
                            {experiment.name}
                          </Link>
                          <span className="font-mono text-xs text-muted-foreground">
                            {shortId(experiment.id)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <StatusBadge state={experiment.state} />
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {experiment.requested_device ?? "—"}
                          {experiment.effective_device &&
                          experiment.effective_device !== experiment.requested_device ? (
                            <span className="block text-muted-foreground">
                              {t("experiments.effectiveDevice", {
                                device: experiment.effective_device,
                              })}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {enumLabel(experiment.collection.status, "collection")}
                          {experiment.collection.error ? (
                            <span className="block max-w-48 truncate text-xs text-destructive">
                              {experiment.collection.error}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>{experiment.revision}</TableCell>
                        <TableCell>{formatDate(experiment.created_at)}</TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t("experiments.actionsAria")}
                              >
                                <MoreHorizontalIcon />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuGroup>
                                <DropdownMenuItem asChild>
                                  <Link to={`/experiments/${experiment.id}`}>
                                    {t("experiments.viewDetails")}
                                  </Link>
                                </DropdownMenuItem>
                                {experiment.state === "draft" ? (
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      setEditing(experiment)
                                      setFormOpen(true)
                                    }}
                                  >
                                    {t("experiments.editDraft")}
                                  </DropdownMenuItem>
                                ) : null}
                                {experiment.state === "draft" ? (
                                  <DropdownMenuItem onSelect={() => void enqueue([experiment.id])}>
                                    {t("experiments.submitQueue")}
                                  </DropdownMenuItem>
                                ) : null}
                                {STOPPABLE_STATES.has(experiment.state) ? (
                                  <DropdownMenuItem onSelect={() => void stop(experiment)}>
                                    <StopCircleIcon />
                                    {t("experiments.requestStop")}
                                  </DropdownMenuItem>
                                ) : null}
                                <DropdownMenuItem
                                  onSelect={() => {
                                    void validate(experiment)
                                  }}
                                >
                                  {t("experiments.validate")}
                                </DropdownMenuItem>
                                {!ACTIVE_STATES.has(experiment.state) ? (
                                  <DropdownMenuItem onSelect={() => void copy(experiment)}>
                                    <CopyIcon />
                                    {t("experiments.copyDraft")}
                                  </DropdownMenuItem>
                                ) : null}
                                <DropdownMenuItem
                                  onSelect={() => {
                                    endpoints.experiments
                                      .export(experiment.id)
                                      .then(() => toast.success(t("common.exportStarted")))
                                      .catch((error: unknown) => toast.error(errorMessage(error)))
                                  }}
                                >
                                  <DownloadIcon />
                                  {t("experiments.exportConfig")}
                                </DropdownMenuItem>
                              </DropdownMenuGroup>
                              {!ACTIVE_STATES.has(experiment.state) ? (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuGroup>
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onSelect={() => setDeleteTarget(experiment)}
                                    >
                                      <Trash2Icon />
                                      {t("experiments.deleteExperiment")}
                                    </DropdownMenuItem>
                                  </DropdownMenuGroup>
                                </>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
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

      <ExperimentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        onSaved={experiments.refresh}
      />

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("experiments.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("experiments.deleteDescription", { name: deleteTarget?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <Button variant="destructive" onClick={remove} disabled={pending}>
              {pending ? t("common.deleting") : t("common.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
