import type { components } from "./schema"

export type Schema = components["schemas"]
export type Battery = Schema["Battery"]
export type DataSource = Schema["DataSource"]
export type Split = Schema["Split"]
export type SplitWrite = Schema["SplitWrite"]
export type SelectionRow = Schema["SplitSourceSelection"]
export type Component = Schema["Component"]
export type Experiment = Schema["ValidatedExperiment"]
export type ExperimentSummary = Schema["ExperimentSummary"]
export type Artifact = Schema["Artifact"]
export type Result = Schema["Result"]
export type Metric = Schema["Metric"]
export type Chart = Schema["ChartSpec"]
export type Page<T> = { items: T[]; total: number; page: number; page_size: number }
export type Validation = {
  valid: boolean
  config: Record<string, unknown>
  split: Record<string, unknown>
  split_text: string
  split_id: string
  split_version: number
  receipt: Record<string, unknown>
  execution_supported: boolean
  limitations: string[]
}
export type NodeResources = {
  id: string
  last_seen_at: string
  resources: {
    cpu_percent?: number | null
    memory_total?: number | null
    memory_available?: number | null
    reason?: string | null
    gpus?: {
      cuda_index: number
      uuid: string
      total_bytes?: number | null
      free_bytes?: number | null
      memory_used_bytes?: number | null
      utilization_percent?: number | null
      reason?: string | null
    }[]
  }
}

export type DomainShiftConfig = {
  source_ids: string[]
  target_ids: string[]
  stride: number
  max_cycles: number
  minimum_coverage: number
  level: "cycle" | "cell"
  feature_groups: string[]
  excluded_features: string[]
  seed: number
  points_per_dataset: number
  pca_fit: "all" | "source"
}
export type DomainShiftCacheStatus = {
  items: {
    source_id: string
    name: string
    cached_files: number
    total_files: number
    missing_files: number
  }[]
  missing_files: number
}
export type DomainShiftJob = {
  id: string
  state: "queued" | "running" | "completed" | "completed_with_errors" | "failed"
  done: number
  total: number
  current_file?: string | null
  built: number
  failed: [string, string, string][]
  error?: string | null
}
export type DomainShiftAnalysis = {
  summary: {
    source_count: number
    target_count: number
    feature_count: number
    sample_count: number
    sample_unit: string
  }
  datasets: {
    source_id: string
    name: string
    domain: string
    cells: number
    samples: number
    extracted_cycles: number
    nominal_capacity_range: string
    temperature_coverage?: number | null
  }[]
  features: { name: string; group: string }[]
  dropped_features: { feature: string; reason: string }[]
  pca: {
    points: {
      dataset: string
      dataset_name: string
      domain: string
      cell_uid: string
      pc1: number
      pc2: number
    }[]
    explained_variance: number[]
    loadings: Record<string, { feature: string; loading: number }[]>
  }
  shift: {
    feature: string
    group: string
    source_mean: number
    target_mean: number
    source_std: number
    target_std: number
    wd_norm: number
    smd: number
    n_source: number
    n_target: number
  }[]
  pairwise: {
    source_id: string
    source_name: string
    target_id: string
    target_name: string
    mean_distance: number
  }[]
}
export type DomainShiftDistribution = {
  feature: string
  series: { key: string; label: string; points: { x: number; y: number }[] }[]
  statistics: {
    source_id: string
    name: string
    count: number
    mean: number
    std: number
    min: number
    median: number
    max: number
  }[]
}
