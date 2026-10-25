import { api, downloadToFile, queryString } from "@/api/client"
import type {
  Artifact,
  Battery,
  Capability,
  ChartBundle,
  ComparisonData,
  Component,
  DataSource,
  DifferenceResult,
  ExperimentSummary,
  LogChunk,
  Metric,
  NamedGroup,
  Page,
  Queue,
  ResourceNode,
  Result,
  Schema,
  SourceOption,
  Split,
  SplitPreviewResponse,
  SplitWrite,
  TrainingValidation,
  ValidatedExperiment,
} from "@/api/models"

export type PageParams = {
  page?: number
  pageSize?: number
  q?: string
}

function pagination({ page = 1, pageSize = 50 }: PageParams) {
  return { page, page_size: pageSize }
}

export const endpoints = {
  sources: {
    list: (params: PageParams = {}, signal?: AbortSignal) =>
      api.get<Page<DataSource>>(`/data-sources${queryString(pagination(params))}`, signal),
    options: (signal?: AbortSignal) => api.get<SourceOption[]>("/data-sources/options", signal),
    files: (sourceId: string, params: PageParams = {}, signal?: AbortSignal) =>
      api.get<Page<Schema["DiscoveredBatteryFile"]>>(
        `/data-sources/${encodeURIComponent(sourceId)}/files${queryString({
          ...pagination(params),
          q: params.q,
        })}`,
        signal,
      ),
  },
  batteries: {
    list: (
      params: PageParams & {
        sourceId?: string
        chemistry?: string
        material?: string
        temperatureC?: number
        nominalCapacityAh?: number
      },
      signal?: AbortSignal,
    ) =>
      api.get<Page<Battery>>(
        `/batteries${queryString({
          ...pagination(params),
          q: params.q,
          source_id: params.sourceId,
          chemistry: params.chemistry,
          material: params.material,
          temperature_c: params.temperatureC,
          nominal_capacity_ah: params.nominalCapacityAh,
        })}`,
        signal,
      ),
    get: (id: string, signal?: AbortSignal) =>
      api.get<Battery>(`/batteries/${encodeURIComponent(id)}`, signal),
  },
  groups: {
    list: (params: PageParams = {}, signal?: AbortSignal) =>
      api.get<Page<NamedGroup>>(`/catalog/named-groups${queryString(pagination(params))}`, signal),
    get: (name: string, signal?: AbortSignal) =>
      api.get<Schema["NamedGroupDetail"]>(
        `/catalog/named-groups/${encodeURIComponent(name)}`,
        signal,
      ),
    members: (
      name: string,
      params: { partition?: "train" | "val" | "test"; page?: number; pageSize?: number },
      signal?: AbortSignal,
    ) =>
      api.get<Page<Schema["Member"]>>(
        `/catalog/named-groups/${encodeURIComponent(name)}/members${queryString({
          partition: params.partition,
          page: params.page ?? 1,
          page_size: params.pageSize ?? 100,
        })}`,
        signal,
      ),
  },
  splits: {
    list: (params: PageParams & { sourceId?: string } = {}, signal?: AbortSignal) =>
      api.get<Page<Split>>(
        `/splits${queryString({
          ...pagination(params),
          q: params.q,
          source_id: params.sourceId,
        })}`,
        signal,
      ),
    get: (id: string, version?: number, signal?: AbortSignal) =>
      api.get<Split>(`/splits/${encodeURIComponent(id)}${queryString({ version })}`, signal),
    preview: (body: SplitWrite) => api.post<SplitPreviewResponse>("/splits/preview", body),
    create: (body: SplitWrite) => api.post<Split>("/splits", body),
    update: (id: string, body: Schema["SplitUpdate"]) =>
      api.put<Split>(`/splits/${encodeURIComponent(id)}`, body),
    remove: (id: string) => api.delete<{ deleted: boolean }>(`/splits/${encodeURIComponent(id)}`),
    members: (
      id: string,
      params: {
        version?: number
        partition?: "train" | "val" | "test"
        page?: number
        pageSize?: number
      } = {},
      signal?: AbortSignal,
    ) =>
      api.get<Page<Schema["Battery"]>>(
        `/splits/${encodeURIComponent(id)}/members${queryString({
          version: params.version,
          partition: params.partition,
          page: params.page ?? 1,
          page_size: params.pageSize ?? 100,
        })}`,
        signal,
      ),
    export: (id: string, version?: number) =>
      downloadToFile(`/splits/${encodeURIComponent(id)}/export${queryString({ version })}`),
    exportDocument: (id: string, version?: number, signal?: AbortSignal) =>
      api.getDocument<Schema["ProviderSplit"]>(
        `/splits/${encodeURIComponent(id)}/export${queryString({ version })}`,
        signal,
      ),
    import: (sourceId: string, file: File) => {
      const form = new FormData()
      form.set("source_id", sourceId)
      form.set("file", file)
      return api.upload<Split>("/splits/import", form)
    },
  },
  experiments: {
    list: (
      params: PageParams & {
        state?: string
        modelType?: string
        taskType?: string
        requestedDevice?: string
      } = {},
      signal?: AbortSignal,
    ) =>
      api.get<Page<ExperimentSummary>>(
        `/validated-experiments${queryString({
          ...pagination(params),
          q: params.q,
          state: params.state,
          model_type: params.modelType,
          task_type: params.taskType,
          requested_device: params.requestedDevice,
        })}`,
        signal,
      ),
    get: (id: string, version?: number, signal?: AbortSignal) =>
      api.get<ValidatedExperiment>(
        `/validated-experiments/${encodeURIComponent(id)}${queryString({ version })}`,
        signal,
      ),
    create: (body: Schema["ValidatedExperimentWrite"]) =>
      api.post<ValidatedExperiment>("/validated-experiments", body),
    update: (id: string, body: Schema["ValidatedExperimentUpdate"]) =>
      api.put<ValidatedExperiment>(`/validated-experiments/${encodeURIComponent(id)}`, body),
    submit: (id: string) =>
      api.post<ValidatedExperiment>(`/validated-experiments/${encodeURIComponent(id)}/submit`),
    stop: (id: string) =>
      api.post<ValidatedExperiment>(`/validated-experiments/${encodeURIComponent(id)}/stop`),
    members: (
      id: string,
      params: {
        version?: number
        partition?: "train" | "val" | "test"
        page?: number
        pageSize?: number
      } = {},
      signal?: AbortSignal,
    ) =>
      api.get<Page<Schema["SplitMember"]>>(
        `/validated-experiments/${encodeURIComponent(id)}/members${queryString({
          version: params.version,
          partition: params.partition,
          page: params.page ?? 1,
          page_size: params.pageSize ?? 100,
        })}`,
        signal,
      ),
    validate: (body: Schema["ValidationRequest"]) =>
      api.post<TrainingValidation>("/training/validation", body),
  },
  scheduler: {
    queue: (signal?: AbortSignal) => api.get<Queue>("/scheduler/queue", signal),
    status: (signal?: AbortSignal) =>
      api.get<Schema["Envelope_dict_str__Any__"]["data"]>("/scheduler/status", signal),
    resources: (signal?: AbortSignal) => api.get<ResourceNode[]>("/scheduler/resources", signal),
  },
  components: {
    list: (scope?: string, signal?: AbortSignal) =>
      api.get<Component[]>(`/components${queryString({ scope })}`, signal),
    schema: (scope: string, type: string, signal?: AbortSignal) =>
      api.get<Record<string, unknown>>(
        `/components/${encodeURIComponent(scope)}/${encodeURIComponent(type)}/schema`,
        signal,
      ),
    upload: (scope: string, file: File) => {
      const form = new FormData()
      form.set("scope", scope)
      form.set("file", file)
      return api.upload<Schema["ComponentUpload"]>("/components/uploads", form)
    },
    checkpoints: (
      params: { componentId?: string; page?: number; pageSize?: number } = {},
      signal?: AbortSignal,
    ) =>
      api.get<Page<Artifact>>(
        `/checkpoints${queryString({
          component_id: params.componentId,
          page: params.page ?? 1,
          page_size: params.pageSize ?? 50,
        })}`,
        signal,
      ),
    uploadCheckpoint: (file: File, componentId: string, sourceExperimentId?: string) => {
      const form = new FormData()
      form.set("file", file)
      form.set("component_id", componentId)
      if (sourceExperimentId) form.set("source_experiment_id", sourceExperimentId)
      return api.upload<Artifact>("/checkpoints", form)
    },
    capabilities: (signal?: AbortSignal) => api.get<Capability[]>("/capabilities", signal),
  },
  results: {
    get: (id: string, signal?: AbortSignal) =>
      api.get<Result>(`/experiments/${encodeURIComponent(id)}/results`, signal),
    metrics: (
      id: string,
      params: { stage?: string; name?: string; page?: number; pageSize?: number } = {},
      signal?: AbortSignal,
    ) =>
      api.get<Page<Metric>>(
        `/experiments/${encodeURIComponent(id)}/metrics${queryString({
          stage: params.stage,
          name: params.name,
          page: params.page ?? 1,
          page_size: params.pageSize ?? 200,
        })}`,
        signal,
      ),
    artifacts: (id: string, signal?: AbortSignal) =>
      api.get<Artifact[]>(`/experiments/${encodeURIComponent(id)}/artifacts`, signal),
    logs: (
      id: string,
      params: { stream: "train" | "console"; cursor?: string },
      signal?: AbortSignal,
    ) =>
      api.get<LogChunk>(
        `/experiments/${encodeURIComponent(id)}/logs${queryString({
          stream: params.stream,
          cursor: params.cursor,
          limit_bytes: 65536,
        })}`,
        signal,
      ),
    download: (artifactId: string) =>
      downloadToFile(`/artifacts/${encodeURIComponent(artifactId)}/download`),
  },
  analysis: {
    compare: (body: Schema["ComparisonRequest"], signal?: AbortSignal) =>
      api.post<ComparisonData>("/comparisons", body, signal),
    export: (body: Schema["ComparisonExport"]) =>
      downloadToFile("/comparisons/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    charts: (body: Schema["ChartRequest"], signal?: AbortSignal) =>
      api.post<ChartBundle>("/charts", body, signal),
    differences: (body: Schema["DifferenceRequest"], signal?: AbortSignal) =>
      api.post<DifferenceResult>("/differences", body, signal),
  },
}
