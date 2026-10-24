import { useEffect, useState } from "react"

import { api, errorMessage, isCursorInvalid } from "@/api/client"
import type { LogChunk } from "@/api/models"

const MAX_LOG_BYTES = 256 * 1024
const POLL_INTERVAL = 1000

export type LogState = {
  text: string
  state: string
  eof: boolean
  error: string | null
  resetNotice: boolean
}

const EMPTY: LogState = {
  text: "",
  state: "unknown",
  eof: false,
  error: null,
  resetNotice: false,
}

function trimToBytes(text: string, limit: number): string {
  const encoder = new TextEncoder()
  if (encoder.encode(text).byteLength <= limit) {
    return text
  }
  let result = text
  while (encoder.encode(result).byteLength > limit) {
    result = result.slice(Math.max(1, Math.ceil(result.length / 10)))
  }
  return result
}

/**
 * Incrementally poll one log stream and keep at most 256 KiB in the browser.
 * Changing the experiment or stream aborts the old request and timer.
 */
export function useLogPolling(
  experimentId: string | undefined,
  stream: "train" | "console",
  enabled: boolean,
) {
  const [value, setValue] = useState<LogState>(EMPTY)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    setValue(EMPTY)
    if (!experimentId || !enabled) {
      return
    }
    let cursor: string | undefined
    let stopped = false
    let timer: number | undefined
    const controller = new AbortController()

    const poll = async () => {
      try {
        const query = new URLSearchParams({ stream, limit_bytes: "65536" })
        if (cursor) {
          query.set("cursor", cursor)
        }
        const chunk = await api.get<LogChunk>(
          `/experiments/${experimentId}/logs?${query.toString()}`,
          controller.signal,
        )
        if (stopped) {
          return
        }
        cursor = chunk.next_cursor
        setValue((previous) => ({
          text: trimToBytes(previous.text + chunk.text, MAX_LOG_BYTES),
          state: chunk.state,
          eof: chunk.eof,
          error: null,
          resetNotice: previous.resetNotice,
        }))
        if (!chunk.eof) {
          timer = window.setTimeout(poll, POLL_INTERVAL)
        }
      } catch (error) {
        if (stopped || controller.signal.aborted) {
          return
        }
        if (isCursorInvalid(error)) {
          cursor = undefined
          setValue((previous) => ({
            ...previous,
            text: "",
            error: null,
            resetNotice: true,
          }))
          timer = window.setTimeout(poll, POLL_INTERVAL)
          return
        }
        setValue((previous) => ({ ...previous, error: errorMessage(error) }))
      }
    }

    void poll()
    return () => {
      stopped = true
      controller.abort()
      if (timer) {
        window.clearTimeout(timer)
      }
    }
  }, [experimentId, stream, enabled, generation])

  return { ...value, retry: () => setGeneration((value) => value + 1) }
}

export { MAX_LOG_BYTES, trimToBytes }
