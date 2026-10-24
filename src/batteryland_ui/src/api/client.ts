/** Unified HTTP boundary for the versioned BatteryLand API. */
import type { Schema } from "@/api/models"

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api/v1"

export type ErrorField = { path: string; message: string }

type ErrorEnvelope = {
  code?: unknown
  message?: unknown
  data?: {
    error?: unknown
    fields?: unknown
    details?: unknown
  }
}

export class ApiError extends Error {
  readonly code: number
  readonly status: number
  readonly symbol: string
  readonly fields: ErrorField[]
  readonly details: Record<string, unknown>

  constructor(
    message: string,
    options: {
      code?: number
      status?: number
      symbol?: string
      fields?: ErrorField[]
      details?: Record<string, unknown>
    } = {},
  ) {
    super(message)
    this.name = "ApiError"
    this.code = options.code ?? 1010
    this.status = options.status ?? 0
    this.symbol = options.symbol ?? "storage_corrupt"
    this.fields = options.fields ?? []
    this.details = options.details ?? {}
  }
}

export type QueryValue = string | number | boolean | null | undefined

export function queryString(values: Record<string, QueryValue>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value))
    }
  }
  const result = params.toString()
  return result ? `?${result}` : ""
}

function isErrorField(value: unknown): value is ErrorField {
  return (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    "message" in value &&
    typeof value.path === "string" &&
    typeof value.message === "string"
  )
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: ErrorEnvelope = {}
  try {
    body = (await response.json()) as ErrorEnvelope
  } catch {
    // Non-JSON failures are surface-level transport errors, not business errors.
  }
  const data = body.data ?? {}
  const fields = Array.isArray(data.fields) ? data.fields.filter(isErrorField) : []
  const details =
    typeof data.details === "object" && data.details !== null
      ? (data.details as Record<string, unknown>)
      : {}
  const message =
    typeof body.message === "string" && body.message
      ? body.message
      : `Request failed with status ${response.status}`
  return new ApiError(message, {
    code: typeof body.code === "number" ? body.code : undefined,
    status: response.status,
    symbol: typeof data.error === "string" ? data.error : undefined,
    fields,
    details,
  })
}

async function unwrap<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw await toApiError(response)
  }
  const body = (await response.json()) as { code?: unknown; message?: unknown; data?: T }
  if (body.code !== 0) {
    throw new ApiError(typeof body.message === "string" ? body.message : "Request failed", {
      status: response.status,
      code: typeof body.code === "number" ? body.code : undefined,
    })
  }
  return body.data as T
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...init.headers,
    },
  })
  return unwrap<T>(response)
}

export const api = {
  get<T>(path: string, signal?: AbortSignal): Promise<T> {
    return request<T>(path, { signal })
  },
  post<T>(path: string, body: unknown = {}, signal?: AbortSignal): Promise<T> {
    return request<T>(path, { method: "POST", body: JSON.stringify(body), signal })
  },
  put<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return request<T>(path, { method: "PUT", body: JSON.stringify(body), signal })
  },
  patch<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return request<T>(path, { method: "PATCH", body: JSON.stringify(body), signal })
  },
  delete<T>(path: string, signal?: AbortSignal): Promise<T> {
    return request<T>(path, { method: "DELETE", signal })
  },
  upload<T>(path: string, form: FormData, signal?: AbortSignal): Promise<T> {
    return request<T>(path, { method: "POST", body: form, signal })
  },
  async download(path: string, init: RequestInit = {}): Promise<{ blob: Blob; filename: string }> {
    const response = await fetch(`${API_BASE}${path}`, init)
    if (!response.ok) {
      throw await toApiError(response)
    }
    const disposition = response.headers.get("content-disposition") ?? ""
    const match = /filename="?([^";]+)"?/i.exec(disposition)
    return {
      blob: await response.blob(),
      filename: match?.[1] ?? "download",
    }
  },
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function downloadToFile(path: string, init: RequestInit = {}): Promise<void> {
  const { blob, filename } = await api.download(path, init)
  saveBlob(blob, filename)
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return "Unexpected request failure"
}

export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) {
    return {}
  }
  return Object.fromEntries(error.fields.map((field) => [field.path, field.message]))
}

export function isCursorInvalid(error: unknown): boolean {
  return error instanceof ApiError && (error.symbol === "cursor_invalid" || error.code === 1009)
}

export function capabilitiesPath(): string {
  return "/capabilities"
}

export type UploadArtifact = Schema["ComponentUpload"]
