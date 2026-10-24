import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { errorMessage, fieldErrors } from "@/api/client"
import { endpoints } from "@/api/endpoints"
import type { Artifact, Experiment, Split, Template, Validation } from "@/api/models"
import { AdvancedSection } from "@/components/advanced-section"
import { LoadingState } from "@/components/data-state"
import { type JsonEditorState, parseJsonObject } from "@/components/json-editor"
import { TrainingConfigEditor } from "@/components/training-config-editor"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { useApiQuery } from "@/hooks/use-api-query"

const DEFAULT_CONFIG = {
  mate: { seed: 42, device: "cpu", experiment: "draft" },
  task: { type: "MyTask" },
}

export type BindingState = {
  splitId: string
  splitVersion: number | null
  sourceSplitId: string
  sourceSplitVersion: number | null
  targetSplitId: string
  targetSplitVersion: number | null
  templateId: string
  templateVersion: number | null
  checkpointId: string
}

const EMPTY_BINDINGS: BindingState = {
  splitId: "",
  splitVersion: null,
  sourceSplitId: "",
  sourceSplitVersion: null,
  targetSplitId: "",
  targetSplitVersion: null,
  templateId: "",
  templateVersion: null,
  checkpointId: "",
}

function bindingsFromExperiment(experiment: Experiment): BindingState {
  return {
    splitId: experiment.bindings?.split?.id ?? "",
    splitVersion: experiment.bindings?.split?.version ?? null,
    sourceSplitId: experiment.bindings?.source_split?.id ?? "",
    sourceSplitVersion: experiment.bindings?.source_split?.version ?? null,
    targetSplitId: experiment.bindings?.target_split?.id ?? "",
    targetSplitVersion: experiment.bindings?.target_split?.version ?? null,
    templateId: experiment.bindings?.template?.id ?? "",
    templateVersion: experiment.bindings?.template?.version ?? null,
    checkpointId: experiment.bindings?.checkpoint_id ?? "",
  }
}

function toRequestBody(bindings: BindingState) {
  return {
    ...(bindings.splitId && bindings.splitVersion
      ? { split: { id: bindings.splitId, version: bindings.splitVersion } }
      : {}),
    ...(bindings.sourceSplitId && bindings.sourceSplitVersion
      ? { source_split: { id: bindings.sourceSplitId, version: bindings.sourceSplitVersion } }
      : {}),
    ...(bindings.targetSplitId && bindings.targetSplitVersion
      ? { target_split: { id: bindings.targetSplitId, version: bindings.targetSplitVersion } }
      : {}),
    ...(bindings.templateId && bindings.templateVersion
      ? { template: { id: bindings.templateId, version: bindings.templateVersion } }
      : {}),
    ...(bindings.checkpointId ? { checkpoint_id: bindings.checkpointId } : {}),
  }
}

export function ExperimentFormDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: Experiment | null
  onSaved: () => void
}) {
  const [name, setName] = useState("")
  const [kind, setKind] = useState<"train" | "evaluate" | "transfer">("train")
  const [config, setConfig] = useState<JsonEditorState>(
    parseJsonObject(JSON.stringify(DEFAULT_CONFIG, null, 2)),
  )
  const [bindings, setBindings] = useState<BindingState>(EMPTY_BINDINGS)
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [templateLoading, setTemplateLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const templateRequest = useRef<AbortController | null>(null)
  const [currentRevision, setCurrentRevision] = useState(editing?.revision ?? 1)
  const [validation, setValidation] = useState<Validation | null>(null)
  const { t } = useTranslation()

  const splits = useApiQuery(
    (signal) => endpoints.splits.list({ page: 1, pageSize: 200 }, signal),
    [open],
    { enabled: open },
  )
  const templates = useApiQuery(
    (signal) => endpoints.templates.list({ page: 1, pageSize: 200 }, signal),
    [open],
    { enabled: open },
  )
  const checkpoints = useApiQuery(
    (signal) => endpoints.components.checkpoints({ page: 1, pageSize: 200 }, signal),
    [open],
    { enabled: open },
  )

  useEffect(() => {
    if (!open) {
      return
    }
    templateRequest.current?.abort()
    setTemplateLoading(false)
    const controller = new AbortController()
    setError(null)
    setFields({})
    setValidation(null)
    if (!editing) {
      setName("")
      setKind("train")
      setConfig(parseJsonObject(JSON.stringify(DEFAULT_CONFIG, null, 2)))
      setBindings(EMPTY_BINDINGS)
      setLoading(false)
      return () => templateRequest.current?.abort()
    }
    setName(editing.name)
    setKind((editing.kind as "train" | "evaluate" | "transfer") ?? "train")
    setBindings(bindingsFromExperiment(editing))
    setLoading(true)
    endpoints.experiments
      .get(editing.id, controller.signal)
      .then((detail) => {
        if (controller.signal.aborted) return
        setCurrentRevision(detail.revision)
        setConfig(parseJsonObject(JSON.stringify(detail.native_config ?? {}, null, 2)))
        setName(detail.name)
        setKind((detail.kind as "train" | "evaluate" | "transfer") ?? "train")
        setBindings(bindingsFromExperiment(detail))
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(failure))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => {
      controller.abort()
      templateRequest.current?.abort()
    }
  }, [open, editing])

  async function chooseTemplate(templateId: string) {
    templateRequest.current?.abort()
    setTemplateLoading(false)
    const controller = new AbortController()
    templateRequest.current = controller
    if (templateId === "none") {
      setBindings((current) => ({ ...current, templateId: "", templateVersion: null }))
      return
    }
    const previous = { templateId: bindings.templateId, templateVersion: bindings.templateVersion }
    setTemplateLoading(true)
    const template = templates.data?.items.find((item) => item.id === templateId)
    setBindings((current) => ({
      ...current,
      templateId,
      templateVersion: template?.version ?? null,
    }))
    try {
      const detail = await endpoints.templates.get(templateId, template?.version, controller.signal)
      if (controller.signal.aborted) return
      setConfig(parseJsonObject(JSON.stringify(detail.native_config ?? {}, null, 2)))
      if (detail.name)
        setName((current) =>
          current.trim()
            ? current
            : t("experiments.form.templateExperimentName", { name: detail.name }),
        )
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(errorMessage(failure))
        setBindings((current) => ({ ...current, ...previous }))
      }
    } finally {
      if (!controller.signal.aborted) setTemplateLoading(false)
    }
  }

  function selectSplit(
    key: "splitId" | "sourceSplitId" | "targetSplitId",
    versionKey: "splitVersion" | "sourceSplitVersion" | "targetSplitVersion",
    value: string,
  ) {
    const split = splits.data?.items.find((item) => item.id === value)
    setBindings((current) => ({
      ...current,
      [key]: value === "none" ? "" : value,
      [versionKey]: value === "none" ? null : (split?.version ?? null),
    }))
  }

  async function save() {
    setError(null)
    setFields({})
    setValidation(null)
    if (!name.trim()) {
      setError(t("experiments.form.messages.nameRequired"))
      return
    }
    if (!config.value) {
      setError(config.error ?? t("experiments.form.messages.configRequired"))
      return
    }
    setPending(true)
    const payload = {
      name: name.trim(),
      kind,
      native_config: config.value,
      bindings: toRequestBody(bindings),
    }
    try {
      if (editing) {
        await endpoints.experiments.update(editing.id, {
          ...payload,
          expected_revision: currentRevision,
        })
        toast.success(t("experiments.form.messages.saved"))
      } else {
        await endpoints.experiments.create(payload)
        toast.success(t("experiments.form.messages.created"))
      }
      onSaved()
      onOpenChange(false)
    } catch (failure) {
      setError(errorMessage(failure))
      setFields(fieldErrors(failure))
    } finally {
      setPending(false)
    }
  }

  async function validateNow() {
    if (!editing) {
      setError(t("experiments.form.messages.saveFirst"))
      return
    }
    setPending(true)
    setError(null)
    try {
      setValidation(await endpoints.experiments.validate(editing.id))
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setPending(false)
    }
  }

  const splitItems = splits.data?.items ?? []
  const templateItems = templates.data?.items ?? []
  const checkpointItems = checkpoints.data?.items ?? []
  const boundSplit = useMemo(
    () => splitItems.find((item) => item.id === bindings.splitId),
    [splitItems, bindings.splitId],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? t("experiments.form.editTitle") : t("experiments.form.createTitle")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {editing
              ? t("experiments.form.editDescription", { revision: editing.revision })
              : t("experiments.form.createDescription")}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <LoadingState rows={6} />
        ) : (
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={Boolean(fields.name)}>
                <FieldLabel htmlFor="experiment-name">{t("experiments.form.name")}</FieldLabel>
                <Input
                  id="experiment-name"
                  value={name}
                  aria-invalid={Boolean(fields.name)}
                  onChange={(event) => setName(event.target.value)}
                />
                <FieldError>{fields.name}</FieldError>
              </Field>

              <Field>
                <FieldLabel htmlFor="experiment-template">
                  {t("experiments.form.fillFromTemplate")}
                </FieldLabel>
                <Select
                  value={bindings.templateId || "none"}
                  onValueChange={(value) => void chooseTemplate(value)}
                >
                  <SelectTrigger id="experiment-template">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="none">{t("experiments.form.noTemplate")}</SelectItem>
                      {templateItems.map((template: Template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {t("common.versionedName", {
                            name: template.name,
                            version: template.version,
                          })}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="experiment-split">
                  {kind === "transfer"
                    ? t("experiments.form.validationSplit")
                    : t("experiments.form.dataSplit")}
                </FieldLabel>
                <Select
                  value={bindings.splitId || "none"}
                  onValueChange={(value) => selectSplit("splitId", "splitVersion", value)}
                >
                  <SelectTrigger id="experiment-split">
                    <SelectValue placeholder={t("experiments.form.notBound")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="none">{t("experiments.form.notBound")}</SelectItem>
                      {splitItems.map((split: Split) => (
                        <SelectItem key={split.id} value={split.id}>
                          {t("common.versionedName", { name: split.name, version: split.version })}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {boundSplit ? (
                  <FieldDescription>
                    {t("experiments.form.partitionCounts", {
                      train: boundSplit.counts.train ?? 0,
                      val: boundSplit.counts.val ?? 0,
                      test: boundSplit.counts.test ?? 0,
                    })}
                  </FieldDescription>
                ) : null}
              </Field>
              {kind === "transfer" ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="experiment-source-split">
                      {t("experiments.form.sourceSplit")}
                    </FieldLabel>
                    <Select
                      value={bindings.sourceSplitId || "none"}
                      onValueChange={(value) =>
                        selectSplit("sourceSplitId", "sourceSplitVersion", value)
                      }
                    >
                      <SelectTrigger id="experiment-source-split">
                        <SelectValue placeholder={t("experiments.form.notBound")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="none">{t("experiments.form.notBound")}</SelectItem>
                          {splitItems.map((split: Split) => (
                            <SelectItem key={split.id} value={split.id}>
                              {t("common.versionedName", {
                                name: split.name,
                                version:
                                  split.id === bindings.splitId
                                    ? (bindings.splitVersion ?? split.version)
                                    : split.version,
                              })}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="experiment-target-split">
                      {t("experiments.form.targetSplit")}
                    </FieldLabel>
                    <Select
                      value={bindings.targetSplitId || "none"}
                      onValueChange={(value) =>
                        selectSplit("targetSplitId", "targetSplitVersion", value)
                      }
                    >
                      <SelectTrigger id="experiment-target-split">
                        <SelectValue placeholder={t("experiments.form.notBound")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="none">{t("experiments.form.notBound")}</SelectItem>
                          {splitItems.map((split: Split) => (
                            <SelectItem key={split.id} value={split.id}>
                              {t("common.versionedName", {
                                name: split.name,
                                version:
                                  split.id === bindings.splitId
                                    ? (bindings.splitVersion ?? split.version)
                                    : split.version,
                              })}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                </>
              ) : null}
            </div>
            <TrainingConfigEditor
              value={config}
              onChange={setConfig}
              rawLabel={t("experiments.form.nativeConfig")}
            />
            <AdvancedSection label={t("workbench.additionalBindings")}>
              <Field>
                <FieldLabel htmlFor="experiment-checkpoint">
                  {t("experiments.form.checkpoint")}
                </FieldLabel>
                <Select
                  value={bindings.checkpointId || "none"}
                  onValueChange={(value) =>
                    setBindings((current) => ({
                      ...current,
                      checkpointId: value === "none" ? "" : value,
                    }))
                  }
                >
                  <SelectTrigger id="experiment-checkpoint">
                    <SelectValue placeholder={t("experiments.form.notBound")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="none">{t("experiments.form.notBound")}</SelectItem>
                      {checkpointItems.map((artifact: Artifact) => (
                        <SelectItem key={artifact.id} value={artifact.id}>
                          {artifact.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </AdvancedSection>
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
            {validation ? (
              <div
                className={
                  validation.valid
                    ? "rounded-md border border-success/30 bg-success/10 p-3 text-sm"
                    : "rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm"
                }
              >
                <p className="font-medium">
                  {validation.valid
                    ? t("experiments.form.validationPassed")
                    : t("experiments.form.validationFailed")}
                </p>
                {validation.errors.length > 0 ? (
                  <ul className="mt-1 list-disc pl-5">
                    {validation.errors.map((item, index) => (
                      <li key={index}>
                        {String(item.message ?? item.error ?? JSON.stringify(item))}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {validation.warnings.length > 0 ? (
                  <ul className="mt-1 list-disc pl-5 text-warning">
                    {validation.warnings.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </FieldGroup>
        )}
        <DialogFooter className="flex-wrap">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          {editing ? (
            <Button variant="secondary" onClick={validateNow} disabled={pending}>
              {t("experiments.form.backendValidation")}
            </Button>
          ) : null}
          <Button
            onClick={save}
            disabled={pending || loading || templateLoading || Boolean(config.error)}
          >
            {pending
              ? t("common.saving")
              : editing
                ? t("experiments.form.saveDraft")
                : t("experiments.form.createDraft")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
