import { FileCodeIcon, PlusIcon, UploadIcon } from "@primer/octicons-react"
import { Button, CounterLabel, FormControl, Label, Select } from "@primer/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { api, download } from "../api/client"
import type { Component } from "../api/types"
import { CodeEditor } from "../components/code-editor"
import { Details, Empty, ErrorNotice, Loading, Modal, PageHeader } from "../components/common"
import { categories } from "../lib/format"

const order = [
  "task",
  "model",
  "datafactory",
  "optimizers",
  "schedulers",
  "loss",
  "metric",
  "validate",
  "runtime",
  "others",
]
export default function ComponentsPage() {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ["components"],
    queryFn: ({ signal }) => api.components(signal),
    staleTime: 300_000,
  })
  const [selected, setSelected] = useState<Component | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadScope, setUploadScope] = useState("")
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const components = query.data ?? []
  const scopes = [...new Set(components.map((item) => item.scope))].sort((a, b) => {
    const ai = order.indexOf(a),
      bi = order.indexOf(b)
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b)
  })
  const mutate = useMutation({
    mutationFn: ({ scope, file }: { scope: string; file: File }) => api.uploadComponent(scope, file),
    onSuccess: () => client.invalidateQueries({ queryKey: ["components"] }),
  })
  return (
    <>
      <PageHeader
        title="组件库"
        description="按照用途分区浏览组件，点击条目查看详情与参数。"
        actions={
          <Button
            leadingVisual={PlusIcon}
            onClick={() => {
              setUploadScope(scopes[0] ?? "model")
              setUploading(true)
            }}
          >
            上传组件
          </Button>
        }
      />
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <Loading />
      ) : !components.length ? (
        <Empty title="暂无可用组件" />
      ) : (
        <>
          <nav className="category-jumps" aria-label="组件分类">
            {scopes.map((scope) => (
              <a key={scope} href={`#component-${scope}`}>
                {categories[scope] ?? scope}
                <CounterLabel>{components.filter((item) => item.scope === scope).length}</CounterLabel>
              </a>
            ))}
          </nav>
          {scopes.map((scope) => (
            <section className="component-category" id={`component-${scope}`} key={scope}>
              <div className="section-title">
                <h2>{categories[scope] ?? scope}</h2>
                <span className="subtle">{scope}</span>
              </div>
              <div className="component-grid">
                {components
                  .filter((item) => item.scope === scope)
                  .sort((a, b) => a.type.localeCompare(b.type))
                  .map((item) => (
                    <button
                      type="button"
                      className="component-item"
                      key={item.id}
                      onClick={() => setSelected(item)}
                    >
                      <FileCodeIcon />
                      <span>{item.type}</span>
                      {item.origin === "uploaded" && <Label size="small">本地</Label>}
                    </button>
                  ))}
              </div>
            </section>
          ))}
        </>
      )}
      {selected && <ComponentDetails item={selected} onClose={() => setSelected(null)} />}
      {uploading && (
        <Modal
          title="上传组件"
          onClose={() => setUploading(false)}
          footer={
            <div className="actions">
              <Button onClick={() => setUploading(false)}>取消</Button>
              <Button
                variant="primary"
                loading={mutate.isPending}
                disabled={!uploadFile || !uploadScope}
                onClick={() => {
                  if (uploadFile && uploadScope)
                    mutate.mutate(
                      { file: uploadFile, scope: uploadScope },
                      {
                        onSuccess: () => {
                          setUploading(false)
                          setUploadFile(null)
                        },
                      },
                    )
                }}
              >
                上传
              </Button>
            </div>
          }
        >
          <ErrorNotice error={mutate.error} />
          <FormControl>
            <FormControl.Label>组件类别</FormControl.Label>
            <Select
              value={uploadScope || scopes[0] || "model"}
              onChange={(event) => setUploadScope(event.target.value)}
            >
              {scopes.map((scope) => (
                <Select.Option key={scope} value={scope}>
                  {categories[scope] ?? scope}
                </Select.Option>
              ))}
            </Select>
          </FormControl>
          <FormControl>
            <FormControl.Label>Python 文件</FormControl.Label>
            <input
              aria-label="组件文件"
              type="file"
              accept=".py"
              onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
            />
          </FormControl>
        </Modal>
      )}
    </>
  )
}

function ComponentDetails({ item, onClose }: { item: Component; onClose: () => void }) {
  const queryClient = useQueryClient()
  const schema = useQuery({
    queryKey: ["component-schema", item.scope, item.type],
    queryFn: ({ signal }) => api.componentSchema(item.scope, item.type, signal),
    staleTime: 300_000,
  })
  const checkpoints = useQuery({
    queryKey: ["checkpoints", item.id],
    queryFn: ({ signal }) => api.checkpoints(item.id, signal),
    enabled: item.scope === "model",
  })
  const fileRef = useRef<HTMLInputElement>(null)
  const upload = useMutation({
    mutationFn: (file: File) => api.uploadCheckpoint(item.id, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["checkpoints", item.id] }),
  })
  const downloadWeight = useMutation({
    mutationFn: (id: string) => download(`/artifacts/${id}/download`, "model-weight"),
  })
  const data = schema.data ?? item.schema ?? {}
  const params = Array.isArray(data.params)
    ? (data.params as {
        name: string
        annotation?: string | null
        required?: boolean
        default?: unknown
        has_default?: boolean
      }[])
    : []
  return (
    <Modal title={item.type} onClose={onClose} wide>
      <div className="actions">
        <Label variant="accent">{categories[item.scope] ?? item.scope}</Label>
        <Label>{item.origin}</Label>
      </div>
      <Details
        values={{
          类型: item.type,
          注册域: item.scope,
          模块: data.module,
          文件: item.resource_ref,
          提供方版本: item.provider_commit,
        }}
      />
      <h3>构造参数</h3>
      <ErrorNotice error={schema.error} />
      {schema.isPending && !item.schema ? (
        <Loading />
      ) : params.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>参数</th>
                <th>类型</th>
                <th>默认值</th>
                <th>配置方式</th>
              </tr>
            </thead>
            <tbody>
              {params.map((param) => (
                <tr key={param.name}>
                  <td>
                    <code>{param.name}</code>
                  </td>
                  <td>{param.annotation ?? "—"}</td>
                  <td>
                    <code>{param.has_default ? JSON.stringify(param.default) : "—"}</code>
                  </td>
                  <td>{param.required ? "必填" : "可选"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="subtle">没有公开构造参数。</p>
      )}
      {item.scope === "model" && (
        <>
          <div className="section-title">
            <h3>模型权重</h3>
            <Button
              size="small"
              leadingVisual={UploadIcon}
              loading={upload.isPending}
              onClick={() => fileRef.current?.click()}
            >
              上传权重
            </Button>
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              aria-label="选择模型权重"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) upload.mutate(file)
                event.target.value = ""
              }}
            />
          </div>
          <ErrorNotice error={upload.error ?? checkpoints.error ?? downloadWeight.error} />
          {checkpoints.data?.items.length ? (
            <div className="compact-list">
              {checkpoints.data.items.map((weight) => (
                <div key={weight.id}>
                  <span>{weight.name}</span>
                  <span className="subtle">{weight.size?.toLocaleString() ?? "—"} bytes</span>
                  <Button size="small" onClick={() => downloadWeight.mutate(weight.id)}>
                    下载
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="subtle">尚未上传权重。</p>
          )}
        </>
      )}
      <details>
        <summary>组件登记数据</summary>
        <CodeEditor
          ariaLabel="组件登记数据 JSON 只读预览"
          height="420px"
          language="json"
          readOnly
          value={JSON.stringify({ ...item, schema: schema.data ?? item.schema })}
        />
      </details>
    </Modal>
  )
}
