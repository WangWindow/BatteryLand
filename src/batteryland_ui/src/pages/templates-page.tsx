import {
  DownloadIcon,
  FileJsonIcon,
  FileUpIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { errorMessage, fieldErrors } from "@/api/client"
import { endpoints } from "@/api/endpoints"
import type { Template } from "@/api/models"
import { ConfirmButton } from "@/components/confirm-button"
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state"
import { JsonEditor, type JsonEditorState, parseJsonObject } from "@/components/json-editor"
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useApiQuery } from "@/hooks/use-api-query"
import { formatDate } from "@/lib/format"

const SAMPLE_CONFIG = {
  mate: { seed: 42, device: "cpu", experiment: "template" },
  task: { type: "MyTask" },
}

export function TemplatesPage() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [draftQuery, setDraftQuery] = useState("")
  const [query, setQuery] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Template | null>(null)
  const [name, setName] = useState("")
  const [config, setConfig] = useState<JsonEditorState>(
    parseJsonObject(JSON.stringify(SAMPLE_CONFIG, null, 2)),
  )
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [importOpen, setImportOpen] = useState(false)
  const [importName, setImportName] = useState("")
  const [importFile, setImportFile] = useState<File | null>(null)

  const templates = useApiQuery(
    (signal) => endpoints.templates.list({ page, pageSize, q: query || undefined }, signal),
    [page, pageSize, query],
  )

  function openCreate() {
    setEditing(null)
    setName("")
    setConfig(parseJsonObject(JSON.stringify(SAMPLE_CONFIG, null, 2)))
    setError(null)
    setFields({})
    setDialogOpen(true)
  }

  async function openEdit(template: Template) {
    setEditing(template)
    setName(template.name)
    setError(null)
    setFields({})
    setDialogOpen(true)
    setLoadingConfig(true)
    try {
      const detail = await endpoints.templates.get(template.id)
      setConfig(
        parseJsonObject(
          JSON.stringify(detail.native_config ?? template.native_config ?? {}, null, 2),
        ),
      )
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setLoadingConfig(false)
    }
  }

  async function save() {
    setError(null)
    setFields({})
    if (!name.trim()) {
      setError(t("templates.messages.nameRequired"))
      return
    }
    if (!config.value) {
      setError(config.error ?? t("templates.messages.configRequired"))
      return
    }
    setPending(true)
    try {
      if (editing) {
        await endpoints.templates.update(editing.id, {
          name: name.trim(),
          native_config: config.value,
          expected_revision: editing.revision,
        })
        toast.success(t("templates.messages.saved"))
      } else {
        await endpoints.templates.create({ name: name.trim(), native_config: config.value })
        toast.success(t("templates.messages.created"))
      }
      setDialogOpen(false)
      templates.refresh()
    } catch (failure) {
      setError(errorMessage(failure))
      setFields(fieldErrors(failure))
      if (
        failure instanceof Error &&
        "symbol" in failure &&
        (failure as { symbol?: string }).symbol === "conflict"
      ) {
        templates.refresh()
      }
    } finally {
      setPending(false)
    }
  }

  async function importTemplate() {
    if (!importName.trim() || !importFile) {
      toast.error(t("templates.messages.importRequired"))
      return
    }
    setPending(true)
    try {
      await endpoints.templates.import(importName.trim(), importFile)
      toast.success(t("templates.messages.imported"))
      setImportOpen(false)
      setImportFile(null)
      setImportName("")
      templates.refresh()
    } catch (failure) {
      toast.error(errorMessage(failure))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <PageHeader
        title={t("templates.title")}
        description={t("templates.description")}
        actions={
          <>
            <Dialog open={importOpen} onOpenChange={setImportOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <FileUpIcon data-icon="inline-start" />
                  {t("templates.importTemplate")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("templates.importTitle")}</DialogTitle>
                  <DialogDescription>{t("templates.importDescription")}</DialogDescription>
                </DialogHeader>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="template-import-name">
                      {t("templates.importName")}
                    </FieldLabel>
                    <Input
                      id="template-import-name"
                      value={importName}
                      onChange={(event) => setImportName(event.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="template-import-file">
                      {t("templates.importFile")}
                    </FieldLabel>
                    <Input
                      id="template-import-file"
                      type="file"
                      accept=".yaml,.yml,.json,application/json,application/yaml"
                      onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                    />
                    <FieldDescription>{t("templates.importLimit")}</FieldDescription>
                  </Field>
                </FieldGroup>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setImportOpen(false)}>
                    {t("common.cancel")}
                  </Button>
                  <Button onClick={importTemplate} disabled={pending || !importFile}>
                    {pending ? t("common.uploading") : t("common.import")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button onClick={openCreate}>
              <PlusIcon data-icon="inline-start" />
              {t("templates.newTemplate")}
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("templates.catalogTitle")}</CardTitle>
          <CardDescription>{t("templates.catalogDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              setPage(1)
              setQuery(draftQuery)
            }}
          >
            <Field className="w-64">
              <FieldLabel htmlFor="template-q">{t("templates.nameFilter")}</FieldLabel>
              <Input
                id="template-q"
                value={draftQuery}
                onChange={(event) => setDraftQuery(event.target.value)}
              />
            </Field>
            <Button type="submit" variant="outline">
              <SearchIcon data-icon="inline-start" />
              {t("templates.search")}
            </Button>
          </form>

          {templates.loading && templates.data === undefined ? <LoadingState rows={4} /> : null}
          {templates.error ? (
            <ErrorState error={templates.error} onRetry={templates.refresh} />
          ) : null}
          {templates.data && templates.data.items.length === 0 ? (
            <EmptyState
              title={t("templates.emptyTitle")}
              description={t("templates.emptyDescription")}
              action={<Button onClick={openCreate}>{t("templates.newTemplate")}</Button>}
            />
          ) : null}
          {templates.data && templates.data.items.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("templates.columns.name")}</TableHead>
                      <TableHead>{t("templates.columns.version")}</TableHead>
                      <TableHead>{t("templates.columns.revision")}</TableHead>
                      <TableHead>{t("templates.columns.createdAt")}</TableHead>
                      <TableHead className="text-right">{t("templates.columns.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {templates.data.items.map((template) => (
                      <TableRow key={template.id}>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            <FileJsonIcon
                              aria-hidden="true"
                              className="size-4 text-muted-foreground"
                            />
                            {template.name}
                          </span>
                        </TableCell>
                        <TableCell>
                          {t("common.versionSummary", {
                            version: template.version,
                            head: template.head_version,
                          })}
                        </TableCell>
                        <TableCell>{template.revision}</TableCell>
                        <TableCell>{formatDate(template.created_at)}</TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void openEdit(template)}
                            >
                              <PencilIcon data-icon="inline-start" />
                              {t("templates.edit")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                endpoints.templates
                                  .export(template.id)
                                  .then(() => toast.success(t("common.exportStarted")))
                                  .catch((failure: unknown) => toast.error(errorMessage(failure)))
                              }
                            >
                              <DownloadIcon data-icon="inline-start" />
                              {t("templates.export")}
                            </Button>
                            <ConfirmButton
                              title={t("templates.deleteTitle")}
                              description={t("templates.deleteDescription")}
                              onConfirm={async () => {
                                try {
                                  await endpoints.templates.remove(template.id)
                                  toast.success(t("templates.messages.deleted"))
                                  templates.refresh()
                                } catch (failure) {
                                  toast.error(errorMessage(failure))
                                }
                              }}
                            >
                              <Trash2Icon data-icon="inline-start" />
                              {t("templates.delete")}
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
                total={templates.data.total}
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? t("templates.editTitle") : t("templates.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? t("templates.editDescription", { revision: editing.revision })
                : t("templates.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={Boolean(fields.name)}>
              <FieldLabel htmlFor="template-name">{t("templates.name")}</FieldLabel>
              <Input
                id="template-name"
                value={name}
                aria-invalid={Boolean(fields.name)}
                onChange={(event) => setName(event.target.value)}
              />
              <FieldError>{fields.name}</FieldError>
            </Field>
            {loadingConfig ? (
              <LoadingState rows={5} />
            ) : (
              <JsonEditor
                label={t("templates.nativeConfig")}
                value={config}
                onChange={setConfig}
                rows={18}
                description={t("templates.nativeConfigDescription")}
              />
            )}
            {error ? <FieldError>{error}</FieldError> : null}
            {Object.entries(fields).length > 0 ? (
              <ul className="list-disc pl-5 text-sm text-destructive">
                {Object.entries(fields).map(([path, message]) => (
                  <li key={path}>
                    {path}: {message}
                  </li>
                ))}
              </ul>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={save} disabled={pending || loadingConfig || Boolean(config.error)}>
              {pending
                ? t("common.saving")
                : editing
                  ? t("templates.saveNewVersion")
                  : t("templates.createTemplate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
