import type {
  Artifact,
  Battery,
  Component,
  DataSource,
  Experiment,
  ExperimentSummary,
  NodeResources,
  Page,
  Result,
  Schema,
  Split,
  SplitWrite,
  Validation,
} from "./types"

const root = "/api/v1"
export function qs(params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, raw] of Object.entries(params)) {
    if (raw === undefined || raw === null || raw === "") continue
    for (const value of Array.isArray(raw) ? raw : [raw]) search.append(key, String(value))
  }
  return search.size ? `?${search}` : ""
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${root}${path}`, init)
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body?.message ?? body?.detail ?? `请求失败（${response.status}）`
    const fields = body?.data?.fields as { path: string; message: string }[] | undefined
    throw new Error(
      fields?.length
        ? `${message}：${fields.map((field) => `${field.path} ${field.message}`).join("；")}`
        : message,
    )
  }
  return body.data as T
}
const get = <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal })
const getText = async (path: string, signal?: AbortSignal): Promise<string> => {
  const response = await fetch(`${root}${path}`, { signal })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.message ?? body?.detail ?? `请求失败（${response.status}）`)
  }
  return response.text()
}
const send = <T>(path: string, body?: unknown, method = "POST") =>
  request<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const file = <T>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form })

export const api = {
  sources: (signal?: AbortSignal) => get<Page<DataSource>>("/data-sources?page_size=200", signal),
  batteries: (
    params: {
      source_ids?: string[]
      q?: string
      availability?: string
      page?: number
      page_size?: number
    } = {},
    signal?: AbortSignal,
  ) => get<Page<Battery>>(`/batteries${qs({ page_size: 120, ...params })}`, signal),
  battery: (id: string, signal?: AbortSignal) => get<Battery>(`/batteries/${encodeURIComponent(id)}`, signal),
  splits: (params: { page?: number; page_size?: number; q?: string } = {}, signal?: AbortSignal) =>
    get<Page<Split>>(`/splits${qs({ page_size: 50, ...params })}`, signal),
  split: (id: string, signal?: AbortSignal) => get<Split>(`/splits/${encodeURIComponent(id)}`, signal),
  previewSplit: (body: SplitWrite) => send<Schema["SplitPreviewResponse"]>("/splits/preview", body),
  createSplit: (body: SplitWrite) => send<Split>("/splits", body),
  updateSplit: (id: string, body: Schema["SplitUpdate"]) =>
    send<Split>(`/splits/${encodeURIComponent(id)}`, body, "PUT"),
  deleteSplit: (id: string) =>
    request<{ deleted: boolean }>(`/splits/${encodeURIComponent(id)}`, { method: "DELETE" }),
  splitMembers: (id: string, partition?: string, page = 1, signal?: AbortSignal) =>
    get<Page<Battery>>(
      `/splits/${encodeURIComponent(id)}/members${qs({ partition, page, page_size: 100 })}`,
      signal,
    ),
  importSplit: (sources: string[], data: File) => {
    const form = new FormData()
    for (const id of sources) form.append("source_ids", id)
    form.set("file", data)
    return file<Split>("/splits/import", form)
  },
  components: (signal?: AbortSignal) => get<Component[]>("/components", signal),
  componentSchema: (scope: string, type: string, signal?: AbortSignal) =>
    get<Record<string, unknown>>(
      `/components/${encodeURIComponent(scope)}/${encodeURIComponent(type)}/schema`,
      signal,
    ),
  uploadComponent: (scope: string, data: File) => {
    const form = new FormData()
    form.set("scope", scope)
    form.set("file", data)
    return file<Schema["ComponentUpload"]>("/components/uploads", form)
  },
  checkpoints: (componentId: string, signal?: AbortSignal) =>
    get<Page<Artifact>>(`/checkpoints${qs({ component_id: componentId, page_size: 200 })}`, signal),
  uploadCheckpoint: (componentId: string, data: File) => {
    const form = new FormData()
    form.set("component_id", componentId)
    form.set("file", data)
    return file<Artifact>("/checkpoints", form)
  },
  experiments: (
    params: { page?: number; page_size?: number; q?: string; state?: string } = {},
    signal?: AbortSignal,
  ) => get<Page<ExperimentSummary>>(`/validated-experiments${qs({ page_size: 50, ...params })}`, signal),
  experiment: (id: string, signal?: AbortSignal) =>
    get<Experiment>(`/validated-experiments/${encodeURIComponent(id)}`, signal),
  validate: (config_text: string, split_id: string, split_version: number) =>
    send<Validation>("/training/validation", { config_text, split_id, split_version }),
  saveExperiment: (body: Schema["ValidatedExperimentWrite"]) =>
    send<Experiment>("/validated-experiments", body),
  updateExperiment: (id: string, body: Schema["ValidatedExperimentUpdate"]) =>
    send<Experiment>(`/validated-experiments/${encodeURIComponent(id)}`, body, "PUT"),
  submit: (id: string) => send<Experiment>(`/validated-experiments/${encodeURIComponent(id)}/submit`),
  stop: (id: string) => send<Experiment>(`/validated-experiments/${encodeURIComponent(id)}/stop`),
  results: (id: string, signal?: AbortSignal) =>
    get<Result>(`/experiments/${encodeURIComponent(id)}/results`, signal),
  artifacts: (id: string, signal?: AbortSignal) =>
    get<Artifact[]>(`/experiments/${encodeURIComponent(id)}/artifacts`, signal),
  artifactText: (id: string, signal?: AbortSignal) =>
    getText(`/artifacts/${encodeURIComponent(id)}/preview/text`, signal),
  logs: (id: string, stream = "console", cursor?: string, signal?: AbortSignal) =>
    get<Schema["LogChunk"]>(
      `/experiments/${encodeURIComponent(id)}/logs${qs({ stream, cursor, limit_bytes: 65536 })}`,
      signal,
    ),
  queue: (signal?: AbortSignal) => get<Schema["Queue"]>("/scheduler/queue", signal),
  resources: (signal?: AbortSignal) => get<NodeResources[]>("/scheduler/resources", signal),
  scheduler: (signal?: AbortSignal) =>
    get<{ enabled: boolean; reason?: string | null }>("/scheduler/status", signal),
  compare: (body: Schema["ComparisonRequest"]) => send<Schema["ComparisonData"]>("/comparisons", body),
  differences: (body: Schema["DifferenceRequest"]) => send<Schema["DifferenceResult"]>("/differences", body),
  charts: (body: Schema["ChartRequest"]) => send<Schema["ChartBundle"]>("/charts", body),
  groups: (signal?: AbortSignal) =>
    get<Page<Schema["NamedGroup"]>>("/catalog/named-groups?page_size=200", signal),
  catalogStatus: (signal?: AbortSignal) => get<Schema["CatalogStatus"]>("/catalog/status", signal),
  selectionPreview: (body: Schema["PreviewWrite"], page = 1, signal?: AbortSignal) =>
    request<Page<Battery>>(`/logical-datasets/preview${qs({ page, page_size: 40 })}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }),
  logicalDatasets: (page = 1, signal?: AbortSignal) =>
    get<Page<Schema["LogicalDataset"]>>(`/logical-datasets${qs({ page, page_size: 50 })}`, signal),
  logicalDataset: (id: string, signal?: AbortSignal) =>
    get<Schema["LogicalDataset"]>(`/logical-datasets/${encodeURIComponent(id)}`, signal),
  logicalDatasetMembers: (id: string, page = 1, signal?: AbortSignal) =>
    get<Page<Schema["LogicalDatasetMember"]>>(
      `/logical-datasets/${encodeURIComponent(id)}/members${qs({ page, page_size: 50 })}`,
      signal,
    ),
  createLogicalDataset: (body: Schema["LogicalDatasetWrite"]) =>
    send<Schema["LogicalDataset"]>("/logical-datasets", body),
  deleteLogicalDataset: (id: string) =>
    request<{ deleted: boolean }>(`/logical-datasets/${encodeURIComponent(id)}`, { method: "DELETE" }),
}

export async function download(path: string, name: string): Promise<void> {
  const response = await fetch(`${root}${path}`)
  if (!response.ok) throw new Error(`下载失败（${response.status}）`)
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
