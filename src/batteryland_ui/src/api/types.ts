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
