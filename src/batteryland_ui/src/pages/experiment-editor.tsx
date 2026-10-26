import { CheckIcon, FileIcon, UploadIcon } from "@primer/octicons-react"
import { Button, FormControl, Select, TextInput } from "@primer/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { parse, stringify } from "yaml"
import { api } from "../api/client"
import type { Experiment, Schema, Validation } from "../api/types"
import { CodeEditor } from "../components/code-editor"
import { ErrorNotice, Loading, PageHeader } from "../components/common"
import { ConfigEditor } from "../components/config-editor"
import { date, partitions } from "../lib/format"
import { initialConfig } from "../lib/initial-config"

export default function ExperimentEditorPage() {
  const [params] = useSearchParams()
  const editId = params.get("edit")
  const location = useLocation()
  const navigate = useNavigate()
  const client = useQueryClient()
  const routeState = location.state as { splitId?: string; splitVersion?: number } | null
  const componentsQuery = useQuery({
    queryKey: ["components"],
    queryFn: ({ signal }) => api.components(signal),
    staleTime: 300_000,
  })
  const splitsQuery = useQuery({
    queryKey: ["splits", "select"],
    queryFn: ({ signal }) => api.splits({ page_size: 100 }, signal),
  })
  const resourcesQuery = useQuery({
    queryKey: ["resources"],
    queryFn: ({ signal }) => api.resources(signal),
    refetchInterval: 15000,
  })
  const existingQuery = useQuery({
    queryKey: ["experiment", editId],
    queryFn: ({ signal }) => api.experiment(editId as string, signal),
    enabled: Boolean(editId),
  })
  const [name, setName] = useState("")
  const [splitId, setSplitId] = useState(routeState?.splitId ?? params.get("split") ?? "")
  const [configText, setConfigText] = useState("")
  const [showYaml, setShowYaml] = useState(false)
  const [validation, setValidation] = useState<Validation | null>(null)
  const [importError, setImportError] = useState<unknown>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const didInitialize = useRef(false)
  const components = componentsQuery.data ?? []
  const runnableSplits = splitsQuery.data?.items.filter((item) => item.execution_ready) ?? []
  const yamlError = useMemo(() => {
    try {
      const parsed = parse(configText)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return new Error("YAML 根节点需要是配置对象。")
      }
      return null
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error))
    }
  }, [configText])
  const splitDetail = useQuery({
    queryKey: ["split", splitId],
    queryFn: ({ signal }) => api.split(splitId, signal),
    enabled: Boolean(splitId),
  })
  const devices = useMemo(
    () => [
      "cpu",
      ...(resourcesQuery.data ?? []).flatMap(
        (node) => node.resources.gpus?.map((gpu) => `cuda:${gpu.cuda_index}`) ?? [],
      ),
    ],
    [resourcesQuery.data],
  )

  useEffect(() => {
    if (editId && existingQuery.data && !didInitialize.current) {
      const existing = existingQuery.data
      setName(existing.name)
      setSplitId(existing.split_id ?? "")
      setConfigText(existing.config_text)
      didInitialize.current = true
      return
    }
    if (!editId && !didInitialize.current && componentsQuery.isSuccess && splitDetail.data) {
      setName(`${splitDetail.data.name} 实验`)
      setConfigText(initialConfig(components, splitDetail.data.name))
      didInitialize.current = true
    }
  }, [editId, existingQuery.data, componentsQuery.isSuccess, splitDetail.data, components])

  const validate = useMutation({
    mutationFn: () => {
      if (!splitId || !splitDetail.data) throw new Error("请先选择一个已保存的数据划分")
      return api.validate(configText, splitId, splitDetail.data.version)
    },
    onSuccess: setValidation,
  })
  const save = useMutation({
    mutationFn: async () => {
      if (!validation || !splitId || !name.trim()) throw new Error("先完成校验并填写实验名称")
      const body: Schema["ValidatedExperimentWrite"] = {
        name: name.trim(),
        config_text: configText,
        split_text: validation.split_text,
        split_id: splitId,
        split_version: validation.split_version,
        receipt: validation.receipt,
      }
      if (editId && existingQuery.data)
        return api.updateExperiment(editId, { ...body, expected_revision: existingQuery.data.revision })
      return api.saveExperiment(body)
    },
    onSuccess: (experiment: Experiment) => {
      client.invalidateQueries({ queryKey: ["experiments"] })
      navigate(`/experiments/${experiment.id}`)
    },
  })

  function updateConfig(text: string) {
    setConfigText(text)
    setValidation(null)
  }
  function changeSplit(id: string) {
    setSplitId(id)
    setValidation(null)
    const selected = splitsQuery.data?.items.find((item) => item.id === id)
    const splitToUse = selected ?? (splitDetail.data?.id === id ? splitDetail.data : undefined)
    if (splitToUse && configText) {
      try {
        const config = parse(configText) as Record<string, unknown>
        const factory = config.datafactory as Record<string, unknown> | undefined
        if (factory) {
          const custom = components.find(
            (item) =>
              item.scope === "datafactory" &&
              item.type.toLowerCase() === "batterylandbatterylifedatasetfactory",
          )
          if (custom) factory.type = custom.type
          factory.params = {
            ...((factory.params as Record<string, unknown>) ?? {}),
            dataset: splitToUse.name,
          }
          updateConfig(stringify(config, { lineWidth: 100 }))
        }
      } catch {
        /* Let the YAML editor surface invalid text for correction. */
      }
    }
  }
  async function importFile(file: File) {
    setImportError(null)
    try {
      const text = await file.text()
      parse(text)
      updateConfig(stringify(parse(text), { lineWidth: 100 }))
      setShowYaml(false)
    } catch (error) {
      setImportError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  const blocked =
    validate.isPending ||
    save.isPending ||
    componentsQuery.isPending ||
    splitsQuery.isPending ||
    splitDetail.isPending
  return (
    <>
      <PageHeader
        title={editId ? "编辑实验配置" : "新建实验"}
        description="配置会先交由 DeepPlatform 校验，再保存为一次独立实验。"
        actions={<Button onClick={() => navigate(-1)}>返回</Button>}
      />
      <ErrorNotice
        error={
          componentsQuery.error ??
          splitsQuery.error ??
          resourcesQuery.error ??
          existingQuery.error ??
          splitDetail.error ??
          importError ??
          validate.error ??
          save.error
        }
      />
      {(componentsQuery.isPending || splitsQuery.isPending || (editId && existingQuery.isPending)) && (
        <Loading />
      )}
      {!componentsQuery.isPending && !splitsQuery.isPending && (!editId || !existingQuery.isPending) && (
        <div className="experiment-editor">
          <section className="editor-toolbar">
            <FormControl required>
              <FormControl.Label>实验名称</FormControl.Label>
              <TextInput
                block
                maxLength={200}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：CALCE 模型对比"
              />
            </FormControl>
            <FormControl required>
              <FormControl.Label>数据划分</FormControl.Label>
              <Select value={splitId} onChange={(event) => changeSplit(event.target.value)}>
                <Select.Option value="">选择已保存的数据划分</Select.Option>
                {runnableSplits.map((item) => (
                  <Select.Option key={item.id} value={item.id}>
                    {item.name} · v{item.version} ·{" "}
                    {Object.values(item.counts)
                      .reduce((sum, value) => sum + value, 0)
                      .toLocaleString()}{" "}
                    个电池
                  </Select.Option>
                ))}
              </Select>
            </FormControl>
            {splitDetail.data && (
              <div className="split-summary">
                <strong>
                  {splitDetail.data.name} · v{splitDetail.data.version}
                </strong>
                <span>
                  {partitions
                    .map(
                      (part) =>
                        `${part === "train" ? "训练" : part === "val" ? "验证" : "测试"} ${splitDetail.data?.counts[part] ?? 0}`,
                    )
                    .join("　/　")}
                </span>
                <span>创建于 {date(splitDetail.data.created_at)}</span>
              </div>
            )}
            {splitDetail.data && !splitDetail.data.execution_ready && (
              <div className="notice error" role="status">
                该数据集尚未完全匹配或包含空分组，不能用于新实验。请先修正数据集划分。
              </div>
            )}
            {!runnableSplits.length && (
              <div className="notice">
                需要先保存一个数据划分。
                <Button as="a" href="/splits?create=1" size="small">
                  前往创建
                </Button>
              </div>
            )}
          </section>
          <div className="editor-section-heading">
            <div>
              <h2>训练配置</h2>
              <p className="subtle">在属性面板编辑组件和参数；导入 YAML 后也可以继续可视化修改。</p>
            </div>
            <div className="actions">
              <input
                ref={fileRef}
                className="sr-only"
                type="file"
                accept=".yaml,.yml"
                aria-label="导入 YAML 配置"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void importFile(file)
                  event.target.value = ""
                }}
              />
              <Button leadingVisual={UploadIcon} onClick={() => fileRef.current?.click()}>
                导入 YAML
              </Button>
              <Button
                leadingVisual={FileIcon}
                aria-pressed={showYaml}
                disabled={Boolean(yamlError) && !showYaml}
                onClick={() => setShowYaml((value) => !value)}
              >
                {yamlError && !showYaml ? "修复 YAML" : showYaml ? "属性编辑" : "查看 YAML"}
              </Button>
            </div>
          </div>
          {showYaml || yamlError ? (
            <CodeEditor
              ariaLabel="YAML 配置编辑器"
              height="min(65vh, 680px)"
              language="yaml"
              minHeight="470px"
              value={configText}
              onChange={updateConfig}
            />
          ) : configText ? (
            <ConfigEditor
              text={configText}
              components={components}
              devices={devices}
              onChange={updateConfig}
            />
          ) : (
            <div className="empty">
              <p>选择数据划分后加载属性编辑器。</p>
            </div>
          )}
          {yamlError && <ErrorNotice error={yamlError} />}
          {validation && (
            <div
              className={`validation-result ${validation.execution_supported ? "is-valid" : "is-limited"}`}
            >
              <div className="validation-title">
                <CheckIcon />
                <strong>
                  {validation.execution_supported ? "配置已通过校验" : "配置格式有效，但当前无法运行"}
                </strong>
              </div>
              <div className="validation-facts">
                <span>DeepPlatform 组件和数据划分校验通过</span>
                {validation.limitations.length > 0 && (
                  <ul>
                    {validation.limitations.map((item) => (
                      <li key={item}>{item.replaceAll("_", " ")}</li>
                    ))}
                  </ul>
                )}
              </div>
              <details>
                <summary>查看校验后的数据划分 JSON</summary>
                <CodeEditor
                  ariaLabel="校验后的数据划分 JSON 只读预览"
                  height="360px"
                  language="json"
                  readOnly
                  value={validation.split_text}
                />
              </details>
            </div>
          )}
          <footer className="bottom-actions">
            <div className="subtle">
              {validation
                ? validation.execution_supported
                  ? "已通过校验，可保存并提交运行"
                  : "配置有效，可保存；当前数据或组件尚不支持训练"
                : "保存前需要通过后端校验"}
            </div>
            <div className="actions">
              <Button
                loading={validate.isPending}
                disabled={
                  !name.trim() ||
                  !splitId ||
                  !configText ||
                  Boolean(yamlError) ||
                  blocked ||
                  splitDetail.data?.execution_ready === false
                }
                onClick={() => validate.mutate()}
              >
                校验配置
              </Button>
              <Button
                variant="primary"
                loading={save.isPending}
                disabled={!validation?.valid || !name.trim()}
                onClick={() => save.mutate()}
              >
                {editId ? "保存修改" : "保存实验"}
              </Button>
            </div>
          </footer>
        </div>
      )}
    </>
  )
}
