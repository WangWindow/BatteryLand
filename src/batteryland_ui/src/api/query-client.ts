import { QueryClient } from "@tanstack/react-query"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
    mutations: {
      retry: false,
    },
  },
})

export const queryKeys = {
  sources: ["sources"] as const,
  batteries: (filters: Record<string, unknown>) => ["batteries", filters] as const,
  groups: ["named-groups"] as const,
  splits: (filters: Record<string, unknown> = {}) => ["splits", filters] as const,
  experiments: (filters: Record<string, unknown> = {}) => ["experiments", filters] as const,
  experiment: (id: string) => ["experiment", id] as const,
  queue: ["scheduler", "queue"] as const,
  resources: ["scheduler", "resources"] as const,
  components: (scope?: string) => ["components", scope ?? "all"] as const,
  capabilities: ["capabilities"] as const,
  result: (id: string) => ["result", id] as const,
  artifacts: (id: string) => ["artifacts", id] as const,
  comparison: (ids: string[]) => ["comparison", ...ids] as const,
}
