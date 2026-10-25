import { BoxesIcon, ChevronDownIcon, FileUpIcon, LayersIcon, UploadIcon } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { errorMessage } from "@/api/client"
import { endpoints } from "@/api/endpoints"
import type { Artifact, Capability, Component } from "@/api/models"
import { AdvancedSection } from "@/components/advanced-section"
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state"
import { PageHeader } from "@/components/page-header"
import { PaginationControls } from "@/components/pagination-controls"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { enumLabel, formatBytes, formatDate, shortId } from "@/lib/format"

const SCOPES = ["model", "loss", "metric", "task", "hook", "dataset", "optimizer"]

export function ComponentsPage() {
  const { t } = useTranslation()
  const [scope, setScope] = useState("")
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false)
  const [schemaTarget, setSchemaTarget] = useState<Component | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadScope, setUploadScope] = useState("model")
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [pending, setPending] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [checkpointPage, setCheckpointPage] = useState(1)
  const [checkpointComponent, setCheckpointComponent] = useState("")
  const [checkpointOpen, setCheckpointOpen] = useState(false)
  const [checkpointFile, setCheckpointFile] = useState<File | null>(null)
  const [checkpointSource, setCheckpointSource] = useState("")
  const [checkpointModel, setCheckpointModel] = useState("")

  const capabilities = useApiQuery((signal) => endpoints.components.capabilities(signal), [], {
    enabled: capabilitiesOpen,
  })
  const components = useApiQuery(
    (signal) => endpoints.components.list(scope || undefined, signal),
    [scope],
  )
  const schema = useApiQuery(
    (signal) =>
      schemaTarget
        ? endpoints.components.schema(schemaTarget.scope, schemaTarget.type, signal)
        : Promise.resolve(null),
    [schemaTarget?.scope, schemaTarget?.type],
    { enabled: Boolean(schemaTarget) },
  )
  const checkpoints = useApiQuery(
    (signal) =>
      endpoints.components.checkpoints(
        {
          componentId: checkpointComponent || undefined,
          page: checkpointPage,
          pageSize: 50,
        },
        signal,
      ),
    [checkpointPage, checkpointComponent],
  )

  const modelComponents = (components.data ?? []).filter((component) => component.scope === "model")
  const componentNames = Object.fromEntries(
    (components.data ?? []).map((component) => [
      component.id,
      `${component.scope}/${component.type}`,
    ]),
  )

  async function uploadComponent() {
    if (!uploadScope.trim() || !uploadFile) {
      setUploadError(t("components.messages.uploadRequired"))
      return
    }
    setPending(true)
    setUploadError(null)
    try {
      const result = await endpoints.components.upload(uploadScope.trim(), uploadFile)
      toast.success(
        t("components.messages.uploadFinished", {
          count: result.components.length,
          activation: result.activation,
        }),
      )
      setUploadOpen(false)
      setUploadFile(null)
      components.refresh()
      capabilities.refresh()
    } catch (error) {
      setUploadError(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  async function uploadCheckpoint() {
    if (!checkpointModel || !checkpointFile) {
      toast.error(t("components.messages.checkpointRequired"))
      return
    }
    setPending(true)
    try {
      await endpoints.components.uploadCheckpoint(
        checkpointFile,
        checkpointModel,
        checkpointSource.trim() || undefined,
      )
      toast.success(t("components.messages.checkpointRegistered"))
      setCheckpointOpen(false)
      setCheckpointFile(null)
      setCheckpointSource("")
      checkpoints.refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <PageHeader
        title={t("workflow.market.title")}
        description={t("workflow.market.description")}
        actions={
          <>
            <Dialog
              open={checkpointOpen}
              onOpenChange={(open) => {
                setCheckpointOpen(open)
                if (open && !checkpointModel) {
                  setCheckpointModel(modelComponents[0]?.id ?? "")
                }
              }}
            >
              <DialogTrigger asChild>
                <Button variant="outline">
                  <UploadIcon data-icon="inline-start" />
                  {t("components.registerCheckpoint")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("components.checkpointTitle")}</DialogTitle>
                  <DialogDescription className="sr-only">
                    {t("components.checkpointDescription")}
                  </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="checkpoint-model">
                      {t("components.modelComponent")}
                    </FieldLabel>
                    <Select value={checkpointModel} onValueChange={setCheckpointModel}>
                      <SelectTrigger id="checkpoint-model">
                        <SelectValue placeholder={t("components.chooseModel")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {modelComponents.map((component) => (
                            <SelectItem key={component.id} value={component.id}>
                              {component.type} · {shortId(component.id)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="checkpoint-file">
                      {t("components.checkpointFile")}
                    </FieldLabel>
                    <Input
                      id="checkpoint-file"
                      type="file"
                      onChange={(event) => setCheckpointFile(event.target.files?.[0] ?? null)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="checkpoint-source">
                      {t("components.sourceExperiment")}
                    </FieldLabel>
                    <Input
                      id="checkpoint-source"
                      value={checkpointSource}
                      placeholder={t("components.uuidPlaceholder")}
                      onChange={(event) => setCheckpointSource(event.target.value)}
                    />
                    <FieldDescription>{t("components.sourceExperimentHint")}</FieldDescription>
                  </Field>
                </FieldGroup>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCheckpointOpen(false)}>
                    {t("common.cancel")}
                  </Button>
                  <Button onClick={uploadCheckpoint} disabled={pending || !checkpointFile}>
                    {pending ? t("common.uploading") : t("components.messages.register")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
              <DialogTrigger asChild>
                <Button>
                  <FileUpIcon data-icon="inline-start" />
                  {t("components.uploadComponent")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("components.uploadTitle")}</DialogTitle>
                  <DialogDescription className="sr-only">
                    {t("components.uploadDescription")}
                  </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="component-scope">{t("components.scope")}</FieldLabel>
                    <Select value={uploadScope} onValueChange={setUploadScope}>
                      <SelectTrigger id="component-scope">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {SCOPES.map((value) => (
                            <SelectItem key={value} value={value}>
                              {value}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="component-file">
                      {t("components.componentFile")}
                    </FieldLabel>
                    <Input
                      id="component-file"
                      type="file"
                      accept=".py,text/x-python"
                      onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                    />
                  </Field>
                  {uploadError ? <FieldError>{uploadError}</FieldError> : null}
                </FieldGroup>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setUploadOpen(false)}>
                    {t("common.cancel")}
                  </Button>
                  <Button onClick={uploadComponent} disabled={pending || !uploadFile}>
                    {pending ? t("common.uploading") : t("components.messages.upload")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <AdvancedSection
        label={t("components.capabilitiesTitle")}
        onExpandedChange={setCapabilitiesOpen}
      >
        <Card>
          <CardHeader>
            <CardTitle>{t("components.capabilitiesTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {capabilities.loading && capabilities.data === undefined ? (
              <LoadingState rows={2} />
            ) : null}
            {capabilities.error ? (
              <ErrorState error={capabilities.error} onRetry={capabilities.refresh} />
            ) : null}
            {capabilities.data && capabilities.data.length === 0 ? (
              <EmptyState title={t("components.capabilitiesEmpty")} />
            ) : null}
            {capabilities.data && capabilities.data.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {capabilities.data.map((capability: Capability) => (
                  <div
                    key={capability.provider_id}
                    className="flex flex-col gap-2 rounded-md border p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs font-medium">
                        {capability.provider_id}
                      </span>
                      <span
                        className={
                          capability.available
                            ? "text-xs font-medium text-success"
                            : "text-xs font-medium text-destructive"
                        }
                      >
                        {capability.available
                          ? t("components.available")
                          : t("components.unavailable")}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("components.versionLabel", { version: capability.version })}
                    </p>
                    {capability.reason ? (
                      <p className="text-xs text-destructive">{capability.reason}</p>
                    ) : null}
                    <p className="text-xs leading-relaxed">
                      {t("components.operations", {
                        operations: capability.supported_operations.join(", ") || t("common.none"),
                      })}
                    </p>
                    {capability.limitations.length > 0 ? (
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {t("components.limitations", {
                          limitations: capability.limitations.join("; "),
                        })}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </AdvancedSection>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>{t("components.componentCatalog")}</CardTitle>
          </div>
          <Select
            value={scope || "all"}
            onValueChange={(value) => setScope(value === "all" ? "" : value)}
          >
            <SelectTrigger className="w-40" aria-label={t("components.scopeFilterAria")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">{t("components.allScopes")}</SelectItem>
                {SCOPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {components.loading && components.data === undefined ? <LoadingState rows={4} /> : null}
          {components.error ? (
            <ErrorState error={components.error} onRetry={components.refresh} />
          ) : null}
          {components.data && components.data.length === 0 ? (
            <EmptyState
              title={t("components.componentsEmptyTitle")}
              description={t("components.componentsEmptyDescription")}
            />
          ) : null}
          {components.data && components.data.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {components.data.map((component: Component) => (
                <article
                  key={component.id}
                  className="flex min-h-44 flex-col justify-between rounded-lg border bg-card p-4 transition-colors hover:border-primary/40"
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        {component.scope === "model" ? (
                          <LayersIcon aria-hidden="true" className="size-4" />
                        ) : (
                          <BoxesIcon aria-hidden="true" className="size-4" />
                        )}
                      </span>
                      <span className="rounded-full border px-2 py-0.5 font-mono text-xs text-muted-foreground">
                        {component.scope}
                      </span>
                    </div>
                    <div>
                      <h3 className="font-semibold">{component.type}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{component.origin}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                    <span className="font-mono text-[0.7rem] text-muted-foreground">
                      {shortId(component.provider_commit)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!component.schema}
                      onClick={() => setSchemaTarget(component)}
                    >
                      <ChevronDownIcon data-icon="inline-start" />
                      {t("workflow.market.previewSchema")}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>{t("components.checkpointsTitle")}</CardTitle>
          </div>
          <Select
            value={checkpointComponent || "all"}
            onValueChange={(value) => {
              setCheckpointComponent(value === "all" ? "" : value)
              setCheckpointPage(1)
            }}
          >
            <SelectTrigger className="w-56" aria-label={t("components.modelFilterAria")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">{t("components.allModels")}</SelectItem>
                {modelComponents.map((component) => (
                  <SelectItem key={component.id} value={component.id}>
                    {component.type}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {checkpoints.loading && checkpoints.data === undefined ? <LoadingState rows={3} /> : null}
          {checkpoints.error ? (
            <ErrorState error={checkpoints.error} onRetry={checkpoints.refresh} />
          ) : null}
          {checkpoints.data && checkpoints.data.items.length === 0 ? (
            <EmptyState title={t("components.checkpointsEmpty")} />
          ) : null}
          {checkpoints.data && checkpoints.data.items.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("components.columns.name")}</TableHead>
                    <TableHead>{t("components.columns.modelComponent")}</TableHead>
                    <TableHead>{t("components.columns.sourceExperiment")}</TableHead>
                    <TableHead>{t("components.columns.size")}</TableHead>
                    <TableHead>{t("components.columns.availability")}</TableHead>
                    <TableHead>{t("components.columns.createdAt")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {checkpoints.data.items.map((artifact: Artifact) => (
                    <TableRow key={artifact.id}>
                      <TableCell className="font-mono text-xs">{artifact.name}</TableCell>
                      <TableCell>
                        {artifact.component_id
                          ? (componentNames[artifact.component_id] ??
                            shortId(artifact.component_id))
                          : "—"}
                      </TableCell>
                      <TableCell>{shortId(artifact.experiment_id)}</TableCell>
                      <TableCell>{formatBytes(artifact.size)}</TableCell>
                      <TableCell>{enumLabel(artifact.availability, "availability")}</TableCell>
                      <TableCell>{formatDate(artifact.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <PaginationControls
                page={checkpointPage}
                pageSize={50}
                total={checkpoints.data.total}
                onPageChange={setCheckpointPage}
              />
            </>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={Boolean(schemaTarget)} onOpenChange={(open) => !open && setSchemaTarget(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t("components.schemaTitle", {
                scope: schemaTarget?.scope ?? "",
                type: schemaTarget?.type ?? "",
              })}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t("components.schemaDescription")}
            </DialogDescription>
          </DialogHeader>
          {schema.loading ? <LoadingState rows={4} /> : null}
          {schema.error ? <ErrorState error={schema.error} onRetry={schema.refresh} /> : null}
          {schema.data ? (
            <pre className="max-h-[60vh] overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
              {JSON.stringify(schema.data, null, 2)}
            </pre>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSchemaTarget(null)}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
