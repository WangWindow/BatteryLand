import { Button, TextInput } from "@primer/react"
import { useQuery } from "@tanstack/react-query"
import { type FormEvent, useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { api } from "../api/client"
import { Empty, ErrorNotice, Loading, PageHeader, Pager } from "../components/common"

const pageSize = 40

export default function DataLayerBatteriesPage() {
  const [params, setParams] = useSearchParams()
  const query = params.get("q")?.trim() ?? ""
  const requestedSource = params.get("source") ?? ""
  const requestedPage = Number(params.get("page") ?? "1")
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const [draft, setDraft] = useState(query)

  useEffect(() => setDraft(query), [query])

  const sourceQuery = useQuery({
    queryKey: ["sources"],
    queryFn: ({ signal }) => api.sources(signal),
  })
  const sources = (sourceQuery.data?.items ?? []).filter(
    (source) => source.root_alias === "battery_life" && source.availability === "available",
  )
  const sourceId = sources.some((source) => source.id === requestedSource) ? requestedSource : ""
  const sourceIds = sourceId ? [sourceId] : sources.map((source) => source.id)
  const batteryQuery = useQuery({
    queryKey: ["data-layer-batteries", sourceIds, query, page],
    queryFn: ({ signal }) =>
      api.batteries(
        { source_ids: sourceIds, q: query, availability: "available", page, page_size: pageSize },
        signal,
      ),
    enabled: sourceIds.length > 0,
  })
  const sourceNames = new Map(sources.map((source) => [source.id, source.name]))

  function updateParams(change: { source?: string; q?: string; page?: number }) {
    const next = new URLSearchParams(params)
    if (change.source !== undefined) {
      if (change.source) next.set("source", change.source)
      else next.delete("source")
    }
    if (change.q !== undefined) {
      if (change.q.trim()) next.set("q", change.q.trim())
      else next.delete("q")
    }
    if (change.page && change.page > 1) next.set("page", String(change.page))
    else next.delete("page")
    setParams(next)
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    updateParams({ q: draft })
  }

  const detailSearch = params.toString()
  return (
    <>
      <PageHeader
        title="电池详情"
        description="选择现有 BatteryLife 电池，查看测试条件、容量轨迹和实际 Cycle 的采样曲线。"
      />
      <section className="data-layer-picker" aria-label="选择电池">
        <div className="data-layer-filters">
          <label htmlFor="data-layer-source">数据来源</label>
          <select
            id="data-layer-source"
            value={sourceId}
            onChange={(event) => updateParams({ source: event.target.value })}
            disabled={sources.length === 0}
          >
            <option value="">全部来源</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
          <form onSubmit={submitSearch}>
            <TextInput
              className="data-layer-search-input"
              aria-label="搜索电池文件名"
              placeholder="输入电池编号或文件名"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button type="submit">搜索</Button>
          </form>
        </div>
        <ErrorNotice error={sourceQuery.error ?? batteryQuery.error} />
        {sourceQuery.isError || batteryQuery.isError ? null : sourceQuery.isPending ? (
          <Loading label="正在读取数据来源" />
        ) : sources.length === 0 ? (
          <Empty title="暂无可浏览的 BatteryLife 数据来源" />
        ) : batteryQuery.isPending ? (
          <Loading label="正在查找电池" />
        ) : batteryQuery.data?.items.length ? (
          <>
            <p className="subtle">找到 {batteryQuery.data.total.toLocaleString()} 个可用电池文件。</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>电池文件</th>
                    <th>来源</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {batteryQuery.data.items.map((battery) => (
                    <tr key={battery.id}>
                      <td>{battery.file_name}</td>
                      <td>{sourceNames.get(battery.source_id) ?? "未提供"}</td>
                      <td>
                        <Link
                          to={`/data-layer/batteries/${battery.id}${detailSearch ? `?${detailSearch}` : ""}`}
                        >
                          查看容量与 Cycle 曲线
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={page}
              size={pageSize}
              total={batteryQuery.data.total}
              onChange={(nextPage) => updateParams({ page: nextPage })}
            />
          </>
        ) : (
          <Empty title="没有匹配的电池" />
        )}
      </section>
    </>
  )
}
