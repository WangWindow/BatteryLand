import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useApiQuery } from "@/hooks/use-api-query"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.useRealTimers()
})

describe("useApiQuery polling", () => {
  it("does not abort or overlap a slow request when its poll interval passes", async () => {
    vi.useFakeTimers()
    const first = deferred<string>()
    const signals: AbortSignal[] = []
    const loader = vi.fn((signal: AbortSignal) => {
      signals.push(signal)
      return first.promise
    })

    renderHook(() => useApiQuery(loader, [], { pollMs: 1000 }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(loader).toHaveBeenCalledTimes(1)
    expect(signals[0]?.aborted).toBe(false)
  })

  it("keeps the last successful value visible while the next poll is pending", async () => {
    vi.useFakeTimers()
    const first = deferred<string>()
    const second = deferred<string>()
    const signals: AbortSignal[] = []
    const loader = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockImplementationOnce((signal) => {
        signals.push(signal)
        return first.promise
      })
      .mockImplementationOnce((signal) => {
        signals.push(signal)
        return second.promise
      })

    const { result } = renderHook(() => useApiQuery(loader, [], { pollMs: 1000 }))
    await act(async () => {
      first.resolve("latest queue")
      await first.promise
    })
    expect(result.current.data).toBe("latest queue")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(loader).toHaveBeenCalledTimes(2)
    expect(result.current.data).toBe("latest queue")
    expect(signals[1]?.aborted).toBe(false)
  })

  it("keeps the last successful value visible during manual refresh", async () => {
    const next = deferred<string>()
    const loader = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockResolvedValueOnce("latest queue")
      .mockImplementationOnce(() => next.promise)

    const { result } = renderHook(() => useApiQuery(loader, [], { pollMs: 60_000 }))
    await waitFor(() => {
      expect(result.current.data).toBe("latest queue")
    })

    await act(async () => {
      result.current.refresh()
    })

    expect(loader).toHaveBeenCalledTimes(2)
    expect(result.current.data).toBe("latest queue")
  })
})
