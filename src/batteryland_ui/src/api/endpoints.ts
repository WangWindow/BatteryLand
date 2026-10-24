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
  Experiment,
  ImportReport,
  LogChunk,
  Page,
  Queue,
  Result,
  Schema,
  SetRef,
  SourceOption,
  Split,
  Template,
} from "@/api/models"

export type ListParams = {
  page?: number
  pageSize?: number
  q?: string
}

function paging({ page = 1, pageSize = 50 }: ListParams) {
  return { page, page_size: pageSize }
}

export const endpoints = {
  sources: {
    options: (signal?: AbortSignal) => api.get<SourceOption[]>("/data-sources/options", signal),
    list: (params: ListParams, signal?: AbortSignal) =>
      api.get<Page<DataSource>>(`/data-sources${queryString(paging(params))}`, signal),
    create: (body: Schema["DataSourceWrite"]) => api.post<DataSource>("/data-sources", body),
    files: (sourceId: string, params: ListParams, signal?: AbortSignal) =>
      api.get<Page<Schema["DiscoveredBatteryFile"]>>(
        `/data-sources/${sourceId}/files${queryString({ ...paging(params), q: params.q })}`,
        signal,
      ),
    importBatteries: (sourceId: string, batteries: Schema["BatteryInput"][]) =>
      api.post<ImportReport>(`/data-sources/${sourceId}/import`, { batteries }),
  },
  batteries: {
    list: (
      params: ListParams & {
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
          ...paging(params),
          q: params.q,
          source_id: params.sourceId,
          chemistry: params.chemistry,
          material: params.material,
          temperature_c: params.temperatureC,
          nominal_capacity_ah: params.nominalCapacityAh,
        })}`,
        signal,
      ),
    get: (id: string, signal?: AbortSignal) => api.get<Battery>(`/batteries/${id}`, signal),
  },
  splits: {
    list: (params: ListParams & { sourceId?: string }, signal?: AbortSignal) =>
      api.get<Page<Split>>(
        `/splits${queryString({ ...paging(params), q: params.q, source_id: params.sourceId })}`,
        signal,
      ),
    get: (id: string, version?: number, signal?: AbortSignal) =>
      api.get<Split>(`/splits/${id}${queryString({ version })}`, signal),
    create: (body: Schema["SplitWrite"]) => api.post<Split>("/splits", body),
    update: (id: string, body: Schema["SplitUpdate"]) => api.put<Split>(`/splits/${id}`, body),
    remove: (id: string) => api.delete<{ deleted: boolean }>(`/splits/${id}`),
    members: (
      id: string,
      params: {
        version?: number
        partition?: "train" | "val" | "test"
        page?: number
        pageSize?: number
      },
      signal?: AbortSignal,
    ) =>
      api.get<Page<Battery>>(
        `/splits/${id}/members${queryString({
          version: params.version,
          partition: params.partition,
          page: params.page ?? 1,
          page_size: params.pageSize ?? 50,
        })}`,
        signal,
      ),
    export: (id: string, version?: number) =>
      downloadToFile(`/splits/${id}/export${queryString({ version })}`),
    import: (sourceId: string, file: File) => {
      const form = new FormData()
      form.set("source_id", sourceId)
      form.set("file", file)
      return api.upload<Split>("/splits/import", form)
    },
  },
  templates: {
    list: (params: ListParams, signal?: AbortSignal) =>
      api.get<Page<Template>>(
        `/templates${queryString({ ...paging(params), q: params.q })}`,
        signal,
      ),
    get: (id: string, version?: number, signal?: AbortSignal) =>
      api.get<Template>(`/templates/${id}${queryString({ version })}`, signal),
    create: (body: Schema["TemplateWrite"]) => api.post<Template>("/templates", body),
    update: (id: string, body: Schema["TemplateUpdate"]) =>
      api.put<Template>(`/templates/${id}`, body),
    remove: (id: string) => api.delete<{ deleted: boolean }>(`/templates/${id}`),
    import: (name: string, file: File) => {
      const form = new FormData()
      form.set("name", name)
      form.set("file", file)
      return api.upload<Template>("/templates/import", form)
    },
    export: (id: string, version?: number) =>
      downloadToFile(`/templates/${id}/export${queryString({ version })}`),
  },
  experiments: {
    list: (
      params: ListParams & {
        state?: string
        splitId?: string
        sourceId?: string
        modelType?: string
        taskType?: string
        requestedDevice?: string
      },
      signal?: AbortSignal,
    ) =>
      api.get<Page<Experiment>>(
        `/experiments${queryString({
          ...paging(params),
          q: params.q,
          state: params.state,
          split_id: params.splitId,
          source_id: params.sourceId,
          model_type: params.modelType,
          task_type: params.taskType,
          requested_device: params.requestedDevice,
        })}`,
        signal,
      ),
    get: (id: string, signal?: AbortSignal) => api.get<Experiment>(`/experiments/${id}`, signal),
    create: (body: Schema["ExperimentWrite"]) => api.post<Experiment>("/experiments", body),
    update: (id: string, body: Schema["ExperimentPatch"]) =>
      api.patch<Experiment>(`/experiments/${id}`, body),
    remove: (id: string) => api.delete<{ deleted: boolean }>(`/experiments/${id}`),
    validate: (id: string) => api.post<Schema["Validation"]>(`/experiments/${id}/validate`),
    copy: (id: string, name?: string) =>
      api.post<Experiment>(`/experiments/${id}/copy`, name ? { name } : {}),
    queue: (ids: string[]) => api.post<Experiment[]>("/queue/submissions", { experiment_ids: ids }),
    stop: (id: string) => api.post<Experiment>(`/experiments/${id}/stop`),
    export: (id: string) => downloadToFile(`/experiments/${id}/export`),
    import: (name: string, kind: string, bindings: string, file: File) => {
      const form = new FormData()
      form.set("name", name)
      form.set("kind", kind)
      form.set("bindings", bindings)
      form.set("file", file)
      return api.upload<Experiment>("/experiments/import", form)
    },
  },
  queue: {
    get: (signal?: AbortSignal) => api.get<Queue>("/queue", signal),
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
      params: {
        componentId?: string
        sourceExperimentId?: string
        page?: number
        pageSize?: number
      },
      signal?: AbortSignal,
    ) =>
      api.get<Page<Artifact>>(
        `/checkpoints${queryString({
          component_id: params.componentId,
          source_experiment_id: params.sourceExperimentId,
          page: params.page ?? 1,
          page_size: params.pageSize ?? 50,
        })}`,
        signal,
      ),
    uploadCheckpoint: (file: File, componentId: string, sourceExperimentId?: string) => {
      const form = new FormData()
      form.set("file", file)
      form.set("component_id", componentId)
      if (sourceExperimentId) {
        form.set("source_experiment_id", sourceExperimentId)
      }
      return api.upload<Artifact>("/checkpoints", form)
    },
    capabilities: (signal?: AbortSignal) => api.get<Capability[]>("/capabilities", signal),
  },
  results: {
    metricNames: async (id: string, stage: string, signal?: AbortSignal) => {
      const names = new Set<string>()
      for (let page = 1; ; page++) {
        const result = await api.get<Page<Schema["Metric"]>>(
          `/experiments/${id}/metrics${queryString({ stage, page, page_size: 200 })}`,
          signal,
        )
        for (const row of result.items) names.add(row.name)
        if (page * result.page_size >= result.total || !result.items.length) break
      }
      return [...names]
    },
    get: (id: string, signal?: AbortSignal) =>
      api.get<Result>(`/experiments/${id}/results`, signal),
    artifacts: (id: string, signal?: AbortSignal) =>
      api.get<Artifact[]>(`/experiments/${id}/artifacts`, signal),
    logs: (
      id: string,
      params: { stream: "train" | "console"; cursor?: string },
      signal?: AbortSignal,
    ) =>
      api.get<LogChunk>(
        `/experiments/${id}/logs${queryString({
          stream: params.stream,
          cursor: params.cursor,
          limit_bytes: 65536,
        })}`,
        signal,
      ),
    download: (artifactId: string) => downloadToFile(`/artifacts/${artifactId}/download`),
  },
  analysis: {
    compare: (
      body: { experiment_ids: string[]; metrics?: string[]; battery_ids?: string[] },
      signal?: AbortSignal,
    ) => api.post<ComparisonData>("/comparisons", body, signal),
    export: (body: { experiment_ids: string[]; metrics?: string[]; format: "json" | "csv" }) =>
      downloadToFile(`/comparisons/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    charts: (
      body: {
        chart_type: string
        experiment_ids?: string[]
        sets?: SetRef[]
        metric?: string
        stage?: "train" | "validation" | "test"
        category?: string
      },
      signal?: AbortSignal,
    ) => api.post<ChartBundle>("/charts", body, signal),
    differences: (
      body: { sets: SetRef[]; analysis_kind: string; category?: string },
      signal?: AbortSignal,
    ) => api.post<DifferenceResult>("/differences", body, signal),
  },
}
