import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeftIcon, CheckIcon, FileUpIcon, SaveIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useLocation, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { parseDocument } from "yaml"
import { errorMessage } from "@/api/client"
import { endpoints } from "@/api/endpoints"
import type { Split, TrainingValidation, ValidatedExperiment } from "@/api/models"
import { queryKeys } from "@/api/query-client"
import { ErrorState, LoadingState } from "@/components/data-state"
import { PageHeader } from "@/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { YamlPropertyEditor } from "@/components/yaml-property-editor"

type EditorLocationState = Pick<ValidatedExperiment, "name" | "config_text" | "split_text"> & {
  sourceExperimentId?: string
}

const EMPTY_CONFIG = ""

function configObject(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null
  const document = parseDocument(text, { version: "1.2" })
  if (document.errors.length) return null
  const value = document.toJS()
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function alignDatasetName(configText: string, dataset: string): string {
  const document = parseDocument(configText, { version: "1.2" })
  if (document.errors.length) return configText
  const config = configObject(configText)
  const factory = config?.datafactory
  if (!factory || typeof factory !== "object" || Array.isArray(factory)) return configText
  const parameters = (factory as Record<string, unknown>).params
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return configText
  document.setIn(["datafactory", "params", "dataset"], dataset)
  return document.toString()
}

function makeFingerprint(configText: string, splitText: string): string {
  return JSON.stringify([configText, splitText])
}

export function ExperimentEditorPage() {
  const { t } = useTranslation()
  const { experimentId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isEditing = Boolean(experimentId)
  const locationState = location.state as EditorLocationState | null
  const importRef = useRef<HTMLInputElement>(null)
  const [loadedId, setLoadedId] = useState("")
  const [name, setName] = useState(locationState?.name ?? "")
  const [configText, setConfigText] = useState(locationState?.config_text ?? EMPTY_CONFIG)
  const [splitText, setSplitText] = useState(locationState?.split_text ?? "")
  const [selectedSplitId, setSelectedSplitId] = useState("")
  const [validation, setValidation] = useState<{
    value: TrainingValidation
    fingerprint: string
  } | null>(null)
  const [validationError, setValidationError] = useState<unknown>(null)

  const experimentQuery = useQuery({
    queryKey: queryKeys.experiment(experimentId ?? ""),
    queryFn: ({ signal }) => endpoints.experiments.get(experimentId ?? "", undefined, signal),
    enabled: Boolean(experimentId),
  })
  const splitsQuery = useQuery({
    queryKey: queryKeys.splits({ page: 1, pageSize: 200 }),
    queryFn: ({ signal }) => endpoints.splits.list({ page: 1, pageSize: 200 }, signal),
  })
  const componentsQuery = useQuery({
    queryKey: queryKeys.components(),
    queryFn: ({ signal }) => endpoints.components.list(undefined, signal),
  })
  const resourcesQuery = useQuery({
    queryKey: queryKeys.resources,
    queryFn: ({ signal }) => endpoints.scheduler.resources(signal),
    refetchInterval: 15_000,
  })
  const splitExportQuery = useQuery({
    queryKey: ["split-export", selectedSplitId],
    queryFn: ({ signal }) => endpoints.splits.exportDocument(selectedSplitId, undefined, signal),
    enabled: Boolean(selectedSplitId),
  })

  useEffect(() => {
    const value = experimentQuery.data
    if (!value || loadedId === value.id) return
    setName(value.name)
    setConfigText(value.config_text)
    setSplitText(value.split_text)
    setSelectedSplitId("")
    setValidation(null)
    setLoadedId(value.id)
  }, [experimentQuery.data, loadedId])

  useEffect(() => {
    const value = splitExportQuery.data
    if (!value || !selectedSplitId) return
    const nextSplitText = JSON.stringify(value, null, 2)
    setSplitText(nextSplitText)
    setConfigText((current) => alignDatasetName(current, value.dataset))
    setValidation(null)
    setValidationError(null)
  }, [splitExportQuery.data, selectedSplitId])

  const currentFingerprint = makeFingerprint(configText, splitText)
  const valid = validation?.fingerprint === currentFingerprint ? validation.value : null
  const splits = splitsQuery.data?.items ?? []

  const validationMutation = useMutation({
    mutationFn: (inputs: { configText: string; splitText: string }) =>
      endpoints.experiments.validate({
        config_text: inputs.configText,
        split_text: inputs.splitText,
      }),
    onSuccess: (value, inputs) => {
      setValidation({ value, fingerprint: makeFingerprint(inputs.configText, inputs.splitText) })
      setValidationError(null)
      if (value.valid) toast.success(t("workflow.editor.validationPassed"))
    },
    onError: (error) => {
      setValidation(null)
      setValidationError(error)
    },
  })
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!valid) throw new Error(t("workflow.editor.unsaved"))
      const body = {
        name: name.trim(),
        config_text: configText,
        split_text: splitText,
        receipt: valid.receipt,
      }
      if (experimentId) {
        const draft = experimentQuery.data
        if (!draft) throw new Error(t("workflow.editor.unsaved"))
        return endpoints.experiments.update(experimentId, {
          ...body,
          expected_revision: draft.revision,
        })
      }
      return endpoints.experiments.create(body)
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ["experiments"] })
      toast.success(t("workflow.editor.saved"))
      navigate(`/experiments/${saved.id}`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  function setConfig(value: string) {
    setConfigText(value)
    setValidation(null)
    setValidationError(null)
  }

  async function importConfig(file: File | undefined) {
    if (!file) return
    if (!/\.ya?ml$/i.test(file.name)) {
      toast.error(t("workflow.editor.fileType"))
      return
    }
    const text = await file.text()
    setConfig(text)
    if (importRef.current) importRef.current.value = ""
  }

  function validate() {
    if (!name.trim() || !configText.trim() || !splitText.trim()) {
      setValidationError(new Error(t("workflow.editor.requiredInputs")))
      return
    }
    const parsed = configObject(configText)
    if (!parsed) {
      setValidationError(new Error(t("workflow.editor.parseFailed")))
      return
    }
    validationMutation.mutate({ configText, splitText })
  }

  if (experimentId && experimentQuery.isLoading) return <LoadingState rows={7} />
  if (experimentId && experimentQuery.error)
    return (
      <ErrorState error={experimentQuery.error} onRetry={() => void experimentQuery.refetch()} />
    )
  if (experimentId && experimentQuery.data && experimentQuery.data.state !== "draft") {
    return (
      <>
        <PageHeader title={t("workflow.editor.titleEdit")} />
        <Alert variant="destructive">
          <AlertTitle>{t("workflow.editor.readOnlyTitle")}</AlertTitle>
          <AlertDescription>{t("workflow.editor.readOnlyDescription")}</AlertDescription>
        </Alert>
        <Button asChild variant="outline">
          <Link to={`/experiments/${experimentId}`}>
            <ArrowLeftIcon data-icon="inline-start" />
            {t("workflow.detail.title")}
          </Link>
        </Button>
      </>
    )
  }

  const isConfigObject = Boolean(configObject(configText))
  const availableDevices = [
    ...new Set(
      (resourcesQuery.data ?? []).flatMap((node) =>
        (node.resources.gpus ?? []).map((gpu) => `cuda:${gpu.cuda_index}`),
      ),
    ),
  ].join(", ")

  return (
    <>
      <PageHeader
        title={isEditing ? t("workflow.editor.titleEdit") : t("workflow.editor.titleNew")}
        description={t("workflow.editor.description")}
        actions={
          <Button asChild variant="outline">
            <Link to="/experiments">
              <ArrowLeftIcon data-icon="inline-start" />
              {t("workflow.list.title")}
            </Link>
          </Button>
        }
      />

      {locationState?.sourceExperimentId ? (
        <Alert>
          <AlertTitle>{t("workflow.editor.runAgain")}</AlertTitle>
          <AlertDescription>{t("workflow.editor.createFromRun")}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="pt-5">
          <FieldGroup className="grid gap-4 md:grid-cols-[minmax(16rem,1fr)_minmax(18rem,1.4fr)]">
            <Field>
              <FieldLabel htmlFor="experiment-name">{t("workflow.editor.name")}</FieldLabel>
              <Input
                id="experiment-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="experiment-split">{t("workflow.editor.split")}</FieldLabel>
              <Select
                value={selectedSplitId || (splitText ? "__current__" : "")}
                onValueChange={(value) => {
                  setSelectedSplitId(value === "__current__" ? "" : value)
                  if (value === "__current__") {
                    const original =
                      experimentQuery.data?.split_text ?? locationState?.split_text ?? ""
                    setSplitText(original)
                    setValidation(null)
                  }
                }}
              >
                <SelectTrigger id="experiment-split">
                  <SelectValue placeholder={t("workflow.editor.chooseSplit")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {splitText ? (
                      <SelectItem value="__current__">
                        {t("workflow.editor.currentSplit")}
                      </SelectItem>
                    ) : null}
                    {splits.map((split: Split) => (
                      <SelectItem key={split.id} value={split.id}>
                        {split.name} · {t("workflow.split.total")}:{" "}
                        {Object.values(split.counts).reduce((a, b) => a + b, 0)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {availableDevices ? (
              <Badge variant="outline">{availableDevices}</Badge>
            ) : (
              <span>{t("workflow.monitor.noGpu")}</span>
            )}
            {splitExportQuery.isFetching ? <span role="status">{t("common.loading")}</span> : null}
            {splitExportQuery.error ? (
              <span className="text-destructive">{errorMessage(splitExportQuery.error)}</span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>{t("workflow.editor.config")}</CardTitle>
          <input
            ref={importRef}
            className="hidden"
            type="file"
            accept=".yaml,.yml,application/yaml,text/yaml"
            onChange={(event) => void importConfig(event.target.files?.[0])}
          />
          <Button size="sm" variant="outline" onClick={() => importRef.current?.click()}>
            <FileUpIcon data-icon="inline-start" />
            {t("workflow.editor.importYaml")}
          </Button>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="visual">
            <TabsList>
              <TabsTrigger value="visual">{t("workflow.editor.properties")}</TabsTrigger>
              <TabsTrigger value="raw">{t("workflow.editor.advancedYaml")}</TabsTrigger>
            </TabsList>
            <TabsContent value="visual" className="mt-4">
              <YamlPropertyEditor
                source={configText}
                onSourceChange={setConfig}
                components={componentsQuery.data ?? []}
                resources={resourcesQuery.data ?? []}
              />
            </TabsContent>
            <TabsContent value="raw" className="mt-4">
              <Field>
                <FieldLabel htmlFor="config-yaml">{t("workflow.editor.advancedYaml")}</FieldLabel>
                <Textarea
                  id="config-yaml"
                  className="min-h-[28rem] font-mono text-xs leading-5"
                  spellCheck={false}
                  value={configText}
                  onChange={(event) => setConfig(event.target.value)}
                />
              </Field>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {valid ? (
        <Alert variant={valid.execution_supported ? "default" : "destructive"}>
          <CheckIcon />
          <AlertTitle>
            {valid.execution_supported
              ? t("workflow.editor.validationPassed")
              : t("workflow.editor.executionUnavailable")}
          </AlertTitle>
          {valid.limitations.length ? (
            <AlertDescription>{valid.limitations.join(" · ")}</AlertDescription>
          ) : null}
        </Alert>
      ) : null}
      {validationError ? <ErrorState error={validationError} /> : null}
      {validationMutation.error ? <ErrorState error={validationMutation.error} /> : null}
      {valid?.execution_supported === false ? (
        <Alert>
          <AlertTitle>{t("workflow.editor.executionUnavailable")}</AlertTitle>
          <AlertDescription>{valid.limitations.join(" · ")}</AlertDescription>
        </Alert>
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-7 lg:px-7">
        <span className="text-xs text-muted-foreground">
          {valid ? t("workflow.editor.validationPassed") : t("workflow.editor.unsaved")}
        </span>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={validate}
            disabled={!configText.trim() || !splitText.trim() || validationMutation.isPending}
          >
            {validationMutation.isPending
              ? t("workflow.editor.validating")
              : t("workflow.editor.validate")}
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={
              !name.trim() ||
              !isConfigObject ||
              !splitText.trim() ||
              !valid ||
              saveMutation.isPending
            }
          >
            <SaveIcon data-icon="inline-start" />
            {saveMutation.isPending
              ? t("common.saving")
              : isEditing
                ? t("workflow.editor.saveDraft")
                : t("workflow.editor.save")}
          </Button>
        </div>
      </div>
    </>
  )
}
