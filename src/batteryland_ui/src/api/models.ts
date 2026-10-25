import type { components } from "@/api/types"

export type Schema = components["schemas"]
export type Artifact = Schema["Artifact"]
export type Battery = Schema["Battery"]
export type Capability = Schema["Capability"]
export type ChartBundle = Schema["ChartBundle"]
export type ChartSpec = Schema["ChartSpec"]
export type ComparisonData = Schema["ComparisonData"]
export type Component = Schema["Component"]
export type DataSource = Schema["DataSource"]
export type DifferenceResult = Schema["DifferenceResult"]
export type ExperimentSummary = Schema["ExperimentSummary"]
export type LogChunk = Schema["LogChunk"]
export type Metric = Schema["Metric"]
export type NamedGroup = Schema["NamedGroup"]
export type Point = Schema["Point"]
export type Page<T> = {
  items: T[]
  total: number
  page: number
  page_size: number
}
export type Queue = Schema["Queue"]
export type Result = Schema["Result"]
export type Series = Schema["Series"]
export type SetRef = Schema["SetRef"]
export type SourceOption = Schema["SourceOption"]
export type Split = Schema["Split"]
export type SplitPreviewResponse = Schema["SplitPreviewResponse"]
export type SplitWrite = Schema["SplitWrite"]
export type ValidatedExperiment = Schema["ValidatedExperiment"]

export type TrainingValidation = {
  valid: boolean
  config: Record<string, unknown>
  split: Record<string, unknown>
  receipt: Record<string, unknown>
  execution_supported: boolean
  limitations: string[]
}

export type ResourceNode = {
  id: string
  last_seen_at: string
  resources: {
    cpu_percent?: number | null
    memory_total?: number | null
    memory_available?: number | null
    gpus?: {
      cuda_index: number
      uuid: string
      total_bytes?: number | null
      free_bytes?: number | null
      memory_used_bytes?: number | null
      utilization_percent?: number | null
      reason?: string | null
    }[]
    reason?: string | null
    [key: string]: unknown
  }
}
