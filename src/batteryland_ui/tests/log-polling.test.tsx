import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiError, api } from "@/api/client"
import { MAX_LOG_BYTES, trimToBytes, useLogPolling } from "@/hooks/use-log-polling"

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("log polling", () => {
  it("caps display text by UTF-8 byte size and keeps the newest suffix", () => {
    const text = "电池日志".repeat(50_000)
    const trimmed = trimToBytes(text, MAX_LOG_BYTES)
    expect(new TextEncoder().encode(trimmed).byteLength).toBeLessThanOrEqual(MAX_LOG_BYTES)
    expect(text.endsWith(trimmed)).toBe(true)
  })

  it("resets the cursor and reloads after cursor_invalid", async () => {
    vi.useFakeTimers()
    vi.spyOn(api, "get")
      .mockResolvedValueOnce({
        stream: "train",
        text: "first",
        next_cursor: "c1",
        eof: false,
        state: "running",
      })
      .mockRejectedValueOnce(new ApiError("expired", { symbol: "cursor_invalid", code: 1009 }))
      .mockResolvedValueOnce({
        stream: "train",
        text: "second",
        next_cursor: "c2",
        eof: true,
        state: "succeeded",
      })

    const { result } = renderHook(() => useLogPolling("experiment-a", "train", true))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.text).toBe("first")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.text).toBe("")
    expect(result.current.resetNotice).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.text).toBe("second")
    expect(result.current.eof).toBe(true)
    expect(result.current.state).toBe("succeeded")
  })

  it("aborts the old request when the experiment changes", () => {
    const signals: AbortSignal[] = []
    vi.spyOn(api, "get").mockImplementation((_path, signal) => {
      if (signal) {
        signals.push(signal)
      }
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
      })
    })

    const { rerender } = renderHook(({ id }: { id: string }) => useLogPolling(id, "train", true), {
      initialProps: { id: "experiment-a" },
    })
    rerender({ id: "experiment-b" })
    expect(signals[0]?.aborted).toBe(true)
  })
})
