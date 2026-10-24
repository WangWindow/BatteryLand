import { useCallback, useEffect, useRef, useState } from "react"

type QueryState<T> = {
  data: T | undefined
  error: unknown
  loading: boolean
}

type QueryOptions = {
  enabled?: boolean
  keepPrevious?: boolean
  pollMs?: number
}

/**
 * Run one abortable query per dependency change.
 *
 * The loader is intentionally read through a ref so callers can pass inline
 * closures without restarting the request on every render. Pass every value
 * that must invalidate the result through `deps`.
 */
export function useApiQuery<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  options: QueryOptions = {},
) {
  const { enabled = true, keepPrevious = false, pollMs } = options
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<QueryState<T>>({
    data: undefined,
    error: undefined,
    loading: enabled,
  })

  const refresh = useCallback(() => setVersion((value) => value + 1), [])

  useEffect(() => {
    if (!enabled) {
      setState({ data: undefined, error: undefined, loading: false })
      return
    }
    const controller = new AbortController()
    setState((previous) => ({
      data: keepPrevious ? previous.data : undefined,
      error: undefined,
      loading: true,
    }))
    loaderRef
      .current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ data, error: undefined, loading: false })
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState((previous) => ({ data: previous.data, error, loading: false }))
        }
      })
    return () => controller.abort()
    // The caller owns invalidation through deps; including it directly would
    // restart every request because arrays are recreated on each render.
  }, [enabled, keepPrevious, version, ...deps])

  useEffect(() => {
    if (!enabled || !pollMs) {
      return
    }
    const timer = window.setInterval(refresh, pollMs)
    return () => window.clearInterval(timer)
  }, [enabled, pollMs, refresh])

  return { ...state, refresh }
}
