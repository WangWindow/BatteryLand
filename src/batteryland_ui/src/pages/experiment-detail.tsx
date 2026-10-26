import { DownloadIcon, StopIcon } from "@primer/octicons-react"
import { Button } from "@primer/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { api, download } from "../api/client"
import type { Artifact } from "../api/types"
import { CodeEditor } from "../components/code-editor"
import { ErrorNotice, Loading, Modal, PageHeader, StateTag } from "../components/common"
import { bytes, date, partitions } from "../lib/format"

const terminal = new Set(["succeeded", "failed", "stopped", "needs_reconciliation"])
const textExtensions = new Set([
  ".csv",
  ".ini",
  ".json",
  ".jsonl",
  ".log",
  ".md",
  ".py",
  ".sh",
  ".toml",
  ".tsv",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
])
const modelExtensions = new Set([
  ".h5",
  ".keras",
  ".mlmodel",
  ".npy",
  ".npz",
  ".onnx",
  ".pb",
  ".pth",
  ".pt",
  ".safetensors",
  ".tflite",
])

function previewKind(name: string): "model" | "text" | null {
  const suffix = `.${name.split(".").at(-1)?.toLowerCase() ?? ""}`
  if (textExtensions.has(suffix)) return "text"
  if (modelExtensions.has(suffix)) return "model"
  return null
}

function previewLanguage(name: string): "json" | "text" | "yaml" {
  const suffix = name.split(".").at(-1)?.toLowerCase()
  if (suffix === "yaml" || suffix === "yml") return "yaml"
  if (suffix === "json" || suffix === "jsonl") return "json"
  return "text"
}

function displayLogText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.slice(line.lastIndexOf("\r") + 1))
    .join("\n")
}

export default function ExperimentDetailPage() {
  const { id = "" } = useParams()
  const client = useQueryClient(),
    navigate = useNavigate()
  const [stream, setStream] = useState<"train" | "console">("console")
  const [cursor, setCursor] = useState<string | undefined>()
  const [logText, setLogText] = useState("")
  const [previewArtifact, setPreviewArtifact] = useState<Artifact | null>(null)
  const logRef = useRef<HTMLPreElement>(null)
  const experiment = useQuery({
    queryKey: ["experiment", id],
    queryFn: ({ signal }) => api.experiment(id, signal),
    refetchInterval: (query) => (terminal.has(query.state.data?.state ?? "") ? false : 2000),
  })
  const active = experiment.data && !terminal.has(experiment.data.state) && experiment.data.state !== "draft"
  const result = useQuery({
    queryKey: ["result", id],
    queryFn: ({ signal }) => api.results(id, signal),
    enabled: Boolean(experiment.data && terminal.has(experiment.data.state)),
    refetchInterval: false,
  })
  const artifacts = useQuery({
    queryKey: ["artifacts", id],
    queryFn: ({ signal }) => api.artifacts(id, signal),
    enabled: Boolean(experiment.data),
  })
  const artifactPreviewKind = previewArtifact ? previewKind(previewArtifact.name) : null
  const artifactPreviewText = useQuery({
    queryKey: ["artifact-preview", previewArtifact?.id],
    queryFn: ({ signal }) => api.artifactText(previewArtifact?.id ?? "", signal),
    enabled: artifactPreviewKind === "text" && Boolean(previewArtifact),
  })
  const logs = useQuery({
    queryKey: ["logs", id, stream, cursor],
    queryFn: ({ signal }) => api.logs(id, stream, cursor, signal),
    enabled: Boolean(experiment.data && experiment.data.state !== "draft"),
    refetchInterval: (query) => (terminal.has(query.state.data?.state ?? "") ? false : 1500),
  })
  // Log data is scoped to the selected experiment and stream; reset it when either key changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: this effect resets state on identity change.
  useEffect(() => {
    setCursor(undefined)
    setLogText("")
  }, [stream, id])
  useEffect(() => {
    if (!logs.data) return
    if (logs.data.text) setLogText((old) => (old + logs.data.text).slice(-500_000))
    if (logs.data.next_cursor !== cursor) setCursor(logs.data.next_cursor)
  }, [logs.data, cursor])
  // Scroll after appended text; the ref's scrollHeight is the only value needed in the effect.
  // biome-ignore lint/correctness/useExhaustiveDependencies: logText signals a new rendered chunk.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logText])
  const submit = useMutation({
    mutationFn: () => api.submit(id),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["experiment", id] })
      client.invalidateQueries({ queryKey: ["experiments"] })
    },
  })
  const stop = useMutation({
    mutationFn: () => api.stop(id),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["experiment", id] })
      client.invalidateQueries({ queryKey: ["experiments"] })
    },
  })
  const artifactDownload = useMutation({
    mutationFn: (artifactId: string) =>
      download(
        `/artifacts/${encodeURIComponent(artifactId)}/download`,
        artifacts.data?.find((item) => item.id === artifactId)?.name ?? "artifact",
      ),
  })
  const row = experiment.data
  return (
    <>
      <PageHeader
        title={row?.name ?? "实验详情"}
        description={
          row ? `实验 ID ${row.experiment_id} · 配置版本 v${row.version}` : "查看实验配置、运行日志和产物。"
        }
        actions={
          <div className="actions">
            {row?.state === "draft" && (
              <Button as={Link} to={`/experiments/new?edit=${id}`}>
                编辑配置
              </Button>
            )}
            {row?.state === "draft" && (
              <Button
                variant="primary"
                disabled={!(row.receipt as Record<string, unknown>).execution_supported}
                loading={submit.isPending}
                onClick={() => submit.mutate()}
              >
                提交训练
              </Button>
            )}
            {active && (
              <Button
                variant="danger"
                leadingVisual={StopIcon}
                loading={stop.isPending}
                onClick={() => stop.mutate()}
              >
                终止实验
              </Button>
            )}
            <Button onClick={() => navigate("/experiments")}>返回列表</Button>
          </div>
        }
      />
      <ErrorNotice
        error={
          experiment.error ??
          result.error ??
          artifacts.error ??
          logs.error ??
          submit.error ??
          stop.error ??
          artifactDownload.error
        }
      />
      {experiment.isPending ? (
        <Loading />
      ) : (
        row && (
          <div className="detail-layout">
            <section className="detail-main">
              <section className="detail-section">
                <div className="section-title">
                  <h2>运行信息</h2>
                  <StateTag state={row.state} />
                </div>
                <div className="stat-strip">
                  <div>
                    <span>请求设备</span>
                    <strong>{row.requested_device ?? "—"}</strong>
                  </div>
                  <div>
                    <span>调度设备</span>
                    <strong>{row.resolved_device ?? "等待调度"}</strong>
                  </div>
                  <div>
                    <span>实际设备</span>
                    <strong>{row.actual_device ?? "等待运行记录"}</strong>
                  </div>
                  <div>
                    <span>GPU UUID</span>
                    <strong className="metric-small">{row.actual_gpu_uuid ?? "—"}</strong>
                  </div>
                </div>
                <dl className="details-grid detail-meta">
                  <div>
                    <dt>创建时间</dt>
                    <dd>{date(row.created_at)}</dd>
                  </div>
                  <div>
                    <dt>数据划分</dt>
                    <dd>
                      {row.split_id ? (
                        <Link to={`/splits?open=${row.split_id}`}>
                          {row.split_id} · v{row.split_version}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>训练集</dt>
                    <dd>{row.split_counts.train?.toLocaleString() ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>验证集</dt>
                    <dd>{row.split_counts.val?.toLocaleString() ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>测试集</dt>
                    <dd>{row.split_counts.test?.toLocaleString() ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Provider 版本</dt>
                    <dd>
                      <code>{row.provider_commit}</code>
                    </dd>
                  </div>
                </dl>
              </section>
              <section className="detail-section">
                <div className="section-title">
                  <h2>运行日志</h2>
                  <div className="actions">
                    <Button
                      size="small"
                      aria-pressed={stream === "console"}
                      onClick={() => setStream("console")}
                    >
                      控制台
                    </Button>
                    <Button size="small" aria-pressed={stream === "train"} onClick={() => setStream("train")}>
                      训练输出
                    </Button>
                  </div>
                </div>
                {row.state === "draft" ? (
                  <p className="subtle">提交训练后可在此查看日志。</p>
                ) : logs.isPending && !logText ? (
                  <Loading label="等待训练日志" />
                ) : (
                  <pre className="log-view" ref={logRef}>
                    {logText ? displayLogText(logText) : "暂无日志输出。"}
                  </pre>
                )}
              </section>
              <section className="detail-section">
                <div className="section-title">
                  <h2>实验结果</h2>
                  <span className="subtle">
                    {result.data?.available ? `结果版本 v${result.data.version}` : "运行结束后读取"}
                  </span>
                </div>
                {result.isPending && row.state !== "draft" && !terminal.has(row.state) ? (
                  <p className="subtle">训练进行中，结果将在任务结束后生成。</p>
                ) : result.data?.available ? (
                  <>
                    {result.data.warnings.length > 0 && (
                      <ul className="warning-list">
                        {result.data.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    )}
                    {result.data.metrics.length ? (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>阶段</th>
                              <th>指标</th>
                              <th>轮次</th>
                              <th>值</th>
                              <th>单位</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.data.metrics.map((metric) => (
                              <tr
                                key={`${metric.stage}-${metric.name}-${metric.epoch}-${metric.granularity}-${metric.value}-${metric.unit}`}
                              >
                                <td>{metric.stage}</td>
                                <td>{metric.name}</td>
                                <td>{metric.epoch ?? "最终"}</td>
                                <td>{metric.value ?? "—"}</td>
                                <td>{metric.unit || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="subtle">结果文件中没有登记指标。</p>
                    )}
                    {result.data.predictions.length > 0 && (
                      <details>
                        <summary>预测值（{result.data.predictions.length.toLocaleString()} 条）</summary>
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>电池</th>
                                <th>粒度</th>
                                <th>预测值</th>
                                <th>真实值</th>
                              </tr>
                            </thead>
                            <tbody>
                              {result.data.predictions.slice(0, 100).map((prediction) => (
                                <tr
                                  key={`${prediction.battery_id}-${prediction.granularity}-${prediction.prediction}-${prediction.target}`}
                                >
                                  <td>{prediction.file_name}</td>
                                  <td>{prediction.granularity}</td>
                                  <td>{prediction.prediction ?? "—"}</td>
                                  <td>{prediction.target ?? "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {result.data.predictions.length > 100 && (
                            <p className="subtle table-note">此处显示前 100 条。</p>
                          )}
                        </div>
                      </details>
                    )}
                  </>
                ) : (
                  <p className="subtle">{result.data?.reason ?? "尚无可读取的结果。"}</p>
                )}
              </section>
            </section>
            <aside className="detail-side">
              <section className="detail-section">
                <h2>产物</h2>
                {artifacts.isPending ? (
                  <Loading />
                ) : artifacts.data?.length ? (
                  <div className="artifact-list">
                    {artifacts.data.map((artifact) => (
                      <div className="artifact-row" key={artifact.id}>
                        {artifact.availability === "available" &&
                        !artifact.is_directory &&
                        previewKind(artifact.name) ? (
                          <button
                            type="button"
                            className="artifact-preview-trigger"
                            aria-label={`预览 ${artifact.name}`}
                            onClick={() => setPreviewArtifact(artifact)}
                          >
                            <strong>{artifact.name}</strong>
                            <span className="subtle">
                              {artifact.kind} · {bytes(artifact.size)} · 点击预览
                            </span>
                          </button>
                        ) : (
                          <div className="artifact-preview-trigger artifact-preview-unavailable">
                            <strong>{artifact.name}</strong>
                            <span className="subtle">
                              {artifact.kind} · {bytes(artifact.size)} · {artifact.availability}
                            </span>
                          </div>
                        )}
                        <div className="actions">
                          <Button
                            aria-label={`下载 ${artifact.name}`}
                            size="small"
                            leadingVisual={DownloadIcon}
                            onClick={() => artifactDownload.mutate(artifact.id)}
                          >
                            下载
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="subtle">暂无运行产物。</p>
                )}
              </section>
              <section className="detail-section">
                <h2>配置摘要</h2>
                <CodeEditor
                  ariaLabel="实验 YAML 配置只读预览"
                  height="360px"
                  language="yaml"
                  readOnly
                  value={row.config_text}
                />
              </section>
              <section className="detail-section">
                <h2>数据划分清单</h2>
                <CodeEditor
                  ariaLabel="数据划分 JSON 只读预览"
                  height="360px"
                  language="json"
                  readOnly
                  value={row.split_text}
                />
                <p className="subtle">
                  {partitions.map((part) => `${part}: ${row.split_counts[part] ?? 0}`).join(" · ")}
                </p>
              </section>
            </aside>
          </div>
        )
      )}
      {previewArtifact && artifactPreviewKind && (
        <Modal
          extraWide={artifactPreviewKind === "model"}
          title={previewArtifact.name}
          onClose={() => setPreviewArtifact(null)}
          footer={
            <div className="preview-footer">
              <span className="subtle">只读预览 · 不会修改产物</span>
              <Button onClick={() => setPreviewArtifact(null)}>关闭</Button>
            </div>
          }
        >
          {artifactPreviewKind === "text" ? (
            artifactPreviewText.isPending ? (
              <Loading label="正在读取产物" />
            ) : artifactPreviewText.error ? (
              <ErrorNotice error={artifactPreviewText.error} />
            ) : (
              <CodeEditor
                ariaLabel={`${previewArtifact.name} 只读预览`}
                height="min(68vh, 760px)"
                language={previewLanguage(previewArtifact.name)}
                readOnly
                value={artifactPreviewText.data ?? ""}
              />
            )
          ) : (
            <iframe
              className="model-preview-frame"
              title={`${previewArtifact.name} 模型结构预览`}
              src={`/api/v1/artifacts/${encodeURIComponent(previewArtifact.id)}/preview/model`}
            />
          )}
        </Modal>
      )}
    </>
  )
}
