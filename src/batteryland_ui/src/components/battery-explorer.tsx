import {
  ArrowLeftIcon,
  FileDirectoryIcon,
  ListUnorderedIcon,
  PlusIcon,
  SearchIcon,
  ThreeBarsIcon,
  TrashIcon,
} from "@primer/octicons-react"
import { Button, Checkbox, FormControl, SegmentedControl, TextInput } from "@primer/react"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  type CSSProperties,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../api/client"
import type { Battery, DataSource, Schema } from "../api/types"
import { date, display, metadataNames, number, sourceColor } from "../lib/format"
import { batterySelection, countSelection, includes, type Selection, sourceSelection } from "../lib/selection"
import { Details, Empty, ErrorNotice, Loading, Modal, Pager } from "./common"

type ViewMode = "physical" | "logical"

export function BatteryExplorer({
  selection,
  setSelection,
  allowLogicalDataset = true,
}: {
  selection: Selection
  setSelection: Dispatch<SetStateAction<Selection>>
  allowLogicalDataset?: boolean
}) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const [mode, setMode] = useState<ViewMode>("physical")
  const [openSourceId, setOpenSourceId] = useState<string | null>(null)
  const [folderSearch, setFolderSearch] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [view, setView] = useState<"cloud" | "list">("cloud")
  const [detail, setDetail] = useState<string | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [cartPage, setCartPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [createdName, setCreatedName] = useState<string | null>(null)
  const [datasetDetail, setDatasetDetail] = useState<string | null>(null)
  const [datasetName, setDatasetName] = useState("")
  const [datasetDescription, setDatasetDescription] = useState("")
  const [dragged, setDragged] = useState(false)
  const drag = useRef<{ sourceId: string; startIndex: number; moved: boolean } | null>(null)
  const pendingDragClick = useRef(false)
  const lastCompletedCatalog = useRef<string | null>(null)

  const sourceQuery = useQuery({
    queryKey: ["sources"],
    queryFn: ({ signal }) => api.sources(signal),
    refetchInterval: 20_000,
  })
  const scanQuery = useQuery({
    queryKey: ["catalog-status"],
    queryFn: ({ signal }) => api.catalogStatus(signal),
    refetchInterval: (query) => (query.state.data?.state === "running" ? 1_500 : 20_000),
  })
  const sources = sourceQuery.data?.items ?? []
  const openSource = sources.find((source) => source.id === openSourceId) ?? null
  const selectedCount = countSelection(selection, sources)
  const selectionRows = useMemo(
    () => Object.values(selection).sort((left, right) => left.source_id.localeCompare(right.source_id)),
    [selection],
  )
  const selectionBody = useMemo<Schema["PreviewWrite"]>(
    () => ({ source_selections: selectionRows }),
    [selectionRows],
  )
  const selectionKey = JSON.stringify(selectionRows)

  const batteryQuery = useQuery({
    queryKey: ["batteries", openSourceId, search, page],
    enabled: mode === "physical" && openSourceId !== null,
    queryFn: ({ signal }) =>
      api.batteries(
        {
          source_ids: openSourceId ? [openSourceId] : [],
          availability: "available",
          q: search,
          page,
          page_size: 120,
        },
        signal,
      ),
    placeholderData: keepPreviousData,
    refetchInterval: 20_000,
  })
  const batteries = batteryQuery.data?.items ?? []
  const logicalQuery = useQuery({
    queryKey: ["logical-datasets"],
    queryFn: ({ signal }) => api.logicalDatasets(1, signal),
    enabled: mode === "logical",
    refetchInterval: 20_000,
  })
  useEffect(() => {
    const status = scanQuery.data
    if (status?.state !== "ready") return
    const token = `${status.generation}:${status.completed_at ?? ""}`
    if (lastCompletedCatalog.current === token) return
    lastCompletedCatalog.current = token
    void client.invalidateQueries({ queryKey: ["sources"] })
    void client.invalidateQueries({ queryKey: ["batteries"] })
    void client.invalidateQueries({ queryKey: ["logical-datasets"] })
  }, [scanQuery.data, client])
  const cartPreview = useQuery({
    queryKey: ["selection-preview", selectionKey, cartPage],
    queryFn: ({ signal }) => api.selectionPreview(selectionBody, cartPage, signal),
    enabled: cartOpen && selectedCount > 0,
    placeholderData: keepPreviousData,
  })

  const createDataset = useMutation({
    mutationFn: () => {
      if (!datasetName.trim()) throw new Error("请填写逻辑数据集名称")
      return api.createLogicalDataset({
        name: datasetName.trim(),
        description: datasetDescription.trim(),
        source_selections: selectionRows,
      })
    },
    onSuccess: (dataset) => {
      client.invalidateQueries({ queryKey: ["logical-datasets"] })
      client.invalidateQueries({ queryKey: ["sources"] })
      setSelection({})
      setCreateOpen(false)
      setCartOpen(false)
      setDatasetName("")
      setDatasetDescription("")
      setCreatedName(dataset.name)
      setMode("logical")
    },
  })
  const deleteDataset = useMutation({
    mutationFn: (id: string) => api.deleteLogicalDataset(id),
    onSuccess: () => client.invalidateQueries({ queryKey: ["logical-datasets"] }),
  })

  useEffect(() => {
    if (!sources.length) return
    setSelection((current) => {
      let changed = false
      const next = { ...current }
      for (const source of sources) {
        const item = next[source.id]
        if (item && item.expected_revision !== source.revision) {
          next[source.id] = { ...item, expected_revision: source.revision }
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [sources, setSelection])

  function toggleBattery(battery: Battery, selected = !includes(selection, battery)) {
    const source = sources.find((item) => item.id === battery.source_id)
    if (source) {
      setSelection((current) => batterySelection(current, battery, source, selected))
    }
  }

  function selectRange(first: number, last: number) {
    const start = Math.min(first, last)
    const end = Math.max(first, last)
    setSelection((current) =>
      batteries.slice(start, end + 1).reduce((next, battery) => {
        const source = sources.find((item) => item.id === battery.source_id)
        return source ? batterySelection(next, battery, source, true) : next
      }, current),
    )
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, index: number) {
    if (event.pointerType !== "mouse" || event.button !== 0) return
    drag.current = { sourceId: openSourceId ?? "", startIndex: index, moved: false }
  }

  function enterDrag(event: ReactPointerEvent<HTMLButtonElement>, index: number) {
    const current = drag.current
    if (!current || event.buttons !== 1 || current.sourceId !== openSourceId) return
    if (current.startIndex !== index) {
      current.moved = true
      pendingDragClick.current = true
      setDragged(true)
      selectRange(current.startIndex, index)
    }
  }

  const finishDrag = useCallback(() => {
    if (drag.current?.moved) pendingDragClick.current = true
    drag.current = null
    setDragged(false)
  }, [])

  useEffect(() => {
    if (!dragged) return
    window.addEventListener("pointerup", finishDrag)
    window.addEventListener("pointercancel", finishDrag)
    return () => {
      window.removeEventListener("pointerup", finishDrag)
      window.removeEventListener("pointercancel", finishDrag)
    }
  }, [dragged, finishDrag])

  function handleBatteryClick(battery: Battery) {
    if (pendingDragClick.current) {
      pendingDragClick.current = false
      return
    }
    toggleBattery(battery)
  }

  function closeSource() {
    setOpenSourceId(null)
    setSearch("")
    setPage(1)
    drag.current = null
  }

  function setWholeSource(source: DataSource, checked: boolean) {
    setSelection((current) => sourceSelection(current, source, checked))
  }

  function clearSelection() {
    setSelection({})
    setCartPage(1)
  }

  const filteredSources = sources.filter((source) =>
    source.name.toLocaleLowerCase().includes(folderSearch.trim().toLocaleLowerCase()),
  )
  const pageSelected = batteries.length > 0 && batteries.every((battery) => includes(selection, battery))
  const selectionStatus = scanQuery.data?.state
  const isSyncing = selectionStatus === "running"

  return (
    <div className="battery-explorer">
      <ErrorNotice error={sourceQuery.error ?? scanQuery.error ?? batteryQuery.error} />
      {createdName && (
        <div className="notice success" role="status">
          已保存逻辑数据集“{createdName}”，现在可以在逻辑数据集列表中查看。
          <button type="button" aria-label="关闭提示" onClick={() => setCreatedName(null)}>
            ×
          </button>
        </div>
      )}
      {scanQuery.data && (
        <div className={`catalog-status ${isSyncing ? "is-syncing" : ""}`} role="status">
          <span className="catalog-status-dot" />
          {isSyncing
            ? "正在后台更新数据目录；目录浏览暂时显示最近一次已完成的索引。"
            : scanQuery.data.state === "failed"
              ? `目录更新失败：${scanQuery.data.error ?? "未知错误"}。继续使用上次完成的索引。`
              : scanQuery.data.completed_at
                ? `目录已索引 ${scanQuery.data.file_count.toLocaleString()} 个文件 · 更新于 ${date(scanQuery.data.completed_at)}`
                : "等待后台首次扫描固定数据目录。"}
        </div>
      )}
      <div className="dataset-tabs" role="tablist" aria-label="数据集目录类型">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "physical"}
          onClick={() => setMode("physical")}
        >
          物理数据集 <span>{sources.length.toLocaleString()}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "logical"}
          onClick={() => setMode("logical")}
        >
          逻辑数据集 <span>{logicalQuery.data?.total.toLocaleString() ?? "—"}</span>
        </button>
      </div>

      {mode === "physical" ? (
        <>
          {sourceQuery.isPending ? (
            <Loading />
          ) : openSource ? (
            <section className="physical-browser" aria-label={`${openSource.name} 电池文件`}>
              <div className="folder-navigation">
                <Button size="small" leadingVisual={ArrowLeftIcon} onClick={closeSource}>
                  所有物理数据集
                </Button>
                <span className="folder-path">/ {openSource.name}</span>
                <span className="grow" />
                <div className="inline-check">
                  <Checkbox
                    aria-label={`选择整个 ${openSource.name}`}
                    checked={Boolean(
                      selection[openSource.id]?.include_all &&
                        !selection[openSource.id]?.excluded_battery_ids?.length,
                    )}
                    indeterminate={
                      Boolean(selection[openSource.id]) &&
                      !(
                        selection[openSource.id]?.include_all &&
                        !selection[openSource.id]?.excluded_battery_ids?.length
                      )
                    }
                    onChange={(event) => setWholeSource(openSource, event.target.checked)}
                  />
                  <span>选择整个数据集（{openSource.available_battery_count.toLocaleString()}）</span>
                </div>
              </div>
              <div className="toolbar">
                <TextInput
                  aria-label="搜索电池文件"
                  placeholder="在当前数据集中搜索文件名…"
                  leadingVisual={SearchIcon}
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setPage(1)
                  }}
                />
                <div className="inline-check">
                  <Checkbox
                    aria-label="选择当前页电池"
                    checked={pageSelected}
                    indeterminate={!pageSelected && batteries.some((battery) => includes(selection, battery))}
                    onChange={(event) => {
                      for (const battery of batteries) toggleBattery(battery, event.target.checked)
                    }}
                  />
                  <span>选择本页</span>
                </div>
                <SegmentedControl
                  aria-label="电池视图"
                  onChange={(index) => setView(index === 0 ? "cloud" : "list")}
                >
                  <SegmentedControl.Button selected={view === "cloud"} leadingVisual={ThreeBarsIcon}>
                    云视图
                  </SegmentedControl.Button>
                  <SegmentedControl.Button selected={view === "list"} leadingVisual={ListUnorderedIcon}>
                    列表
                  </SegmentedControl.Button>
                </SegmentedControl>
              </div>
              {batteryQuery.isPending ? (
                <Loading />
              ) : !batteries.length ? (
                <Empty title={search ? "没有匹配的电池文件" : "这个数据集还没有可用电池文件"} />
              ) : (
                <section
                  aria-busy={batteryQuery.isFetching}
                  className={batteryQuery.isPlaceholderData ? "refreshing" : ""}
                >
                  {view === "cloud" ? (
                    <section className={`battery-grid ${dragged ? "is-dragging" : ""}`} aria-label="电池文件">
                      {batteries.map((battery, index) => (
                        <div
                          className={`battery-file ${includes(selection, battery) ? "is-selected" : ""}`}
                          key={battery.id}
                          style={{ "--source": sourceColor(openSource.id) } as CSSProperties}
                        >
                          <button
                            type="button"
                            className="battery-file-select"
                            aria-label={`${includes(selection, battery) ? "取消选择" : "选择"} ${battery.file_name}`}
                            aria-pressed={includes(selection, battery)}
                            onPointerDown={(event) => startDrag(event, index)}
                            onPointerEnter={(event) => enterDrag(event, index)}
                            onPointerUp={finishDrag}
                            onPointerCancel={finishDrag}
                            onClick={() => handleBatteryClick(battery)}
                          >
                            <span className="file-selection-mark" aria-hidden="true">
                              {includes(selection, battery) ? "✓" : ""}
                            </span>
                            <span className="battery-file-name">{battery.file_name}</span>
                          </button>
                          <button
                            type="button"
                            className="battery-file-info"
                            aria-label={`查看 ${battery.file_name} 的详细信息`}
                            title="查看电池统计特征"
                            onClick={() => setDetail(battery.id)}
                          >
                            i
                          </button>
                        </div>
                      ))}
                    </section>
                  ) : (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>选择</th>
                            <th>电池文件</th>
                            <th>化学体系</th>
                            <th>容量</th>
                            <th>温度</th>
                            <th>信息</th>
                          </tr>
                        </thead>
                        <tbody>
                          {batteries.map((battery) => (
                            <tr key={battery.id}>
                              <td>
                                <Checkbox
                                  aria-label={`选择 ${battery.file_name}`}
                                  checked={includes(selection, battery)}
                                  onChange={(event) => toggleBattery(battery, event.target.checked)}
                                />
                              </td>
                              <td>{battery.file_name}</td>
                              <td>{display(battery.metadata.chemistry)}</td>
                              <td>{number(battery.metadata.nominal_capacity_ah)} Ah</td>
                              <td>{number(battery.metadata.temperature_c)} °C</td>
                              <td>
                                <Button size="small" onClick={() => setDetail(battery.id)}>
                                  统计特征
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <Pager page={page} size={120} total={batteryQuery.data?.total ?? 0} onChange={setPage} />
                  <p className="selection-help">
                    点击文件切换选择；按住鼠标左键并滑过文件，可连续批量选择。选择会保留在其他数据集中。
                  </p>
                </section>
              )}
            </section>
          ) : (
            <>
              <div className="toolbar dataset-list-toolbar">
                <TextInput
                  aria-label="搜索物理数据集"
                  placeholder="搜索数据集文件夹…"
                  leadingVisual={SearchIcon}
                  value={folderSearch}
                  onChange={(event) => setFolderSearch(event.target.value)}
                />
                <span className="subtle">打开文件夹浏览内部电池；勾选可将整个文件夹放入选择篮。</span>
              </div>
              {filteredSources.length === 0 ? (
                <Empty title={sources.length ? "没有匹配的数据集文件夹" : "等待数据目录首次扫描"}>
                  {sources.length === 0 && <p>后端会在启动后自动扫描配置的数据目录，不需要手动导入。</p>}
                </Empty>
              ) : (
                <section className="dataset-folder-list" aria-label="物理数据集文件夹">
                  {filteredSources.map((source) => {
                    const selected = selection[source.id]
                    const all = Boolean(selected?.include_all && !selected.excluded_battery_ids?.length)
                    return (
                      <div
                        className="dataset-folder-row"
                        key={source.id}
                        style={{ "--source": sourceColor(source.id) } as CSSProperties}
                      >
                        <Checkbox
                          aria-label={`选择整个 ${source.name}`}
                          checked={all}
                          indeterminate={Boolean(selected) && !all}
                          disabled={source.available_battery_count === 0}
                          onChange={(event) => setWholeSource(source, event.target.checked)}
                        />
                        <FileDirectoryIcon size={20} />
                        <button
                          type="button"
                          className="dataset-folder-open"
                          onClick={() => setOpenSourceId(source.id)}
                        >
                          <span className="dataset-folder-name">{source.name}</span>
                          <span className="dataset-folder-meta">
                            {source.available_battery_count.toLocaleString()} 个可用电池
                            {source.battery_count !== source.available_battery_count &&
                              ` · ${source.battery_count - source.available_battery_count} 个已移除`}
                            {source.availability !== "available" && " · 目录不可用"}
                          </span>
                        </button>
                        {selected && (
                          <span className="dataset-folder-selected">
                            {selected.include_all
                              ? "已选择整个文件夹"
                              : `已选 ${selected.battery_ids?.length ?? 0} 项`}
                          </span>
                        )}
                        <Button size="small" onClick={() => setOpenSourceId(source.id)}>
                          打开
                        </Button>
                      </div>
                    )
                  })}
                </section>
              )}
            </>
          )}
          {selectedCount > 0 && (
            <SelectionCartBar
              count={selectedCount}
              sourceCount={selectionRows.length}
              onOpen={() => {
                setCartPage(1)
                setCartOpen(true)
              }}
              onClear={clearSelection}
              onCreateDataset={allowLogicalDataset ? () => setCreateOpen(true) : undefined}
              onCreateSplit={allowLogicalDataset ? () => navigate("/splits?create=1") : undefined}
            />
          )}
        </>
      ) : (
        <LogicalDatasetList
          query={logicalQuery}
          onOpen={setDatasetDetail}
          onDelete={(dataset) => {
            if (window.confirm(`删除逻辑数据集“${dataset.name}”？`)) deleteDataset.mutate(dataset.id)
          }}
          deleting={deleteDataset.isPending}
          deleteError={deleteDataset.error}
        />
      )}

      {cartOpen && (
        <Modal
          title={`选择篮 · ${selectedCount.toLocaleString()} 个电池`}
          onClose={() => setCartOpen(false)}
          wide
          footer={
            <div className="actions">
              <Button onClick={clearSelection}>清空选择</Button>
              <span className="grow" />
              <Button onClick={() => setCartOpen(false)}>继续选择</Button>
              {allowLogicalDataset && (
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  保存为逻辑数据集
                </Button>
              )}
            </div>
          }
        >
          <p className="subtle">
            这是独立于文件夹的成员清单。保存后会固定当前成员 ID，并记录物理数据集版本。
          </p>
          <ErrorNotice error={cartPreview.error} />
          {cartPreview.isPending ? (
            <Loading />
          ) : (
            <>
              <div className="cart-member-list">
                {cartPreview.data?.items.map((battery) => (
                  <CartMember
                    key={battery.id}
                    battery={battery}
                    source={sources.find((item) => item.id === battery.source_id)}
                    onRemove={() => toggleBattery(battery, false)}
                  />
                ))}
              </div>
              <Pager page={cartPage} size={40} total={cartPreview.data?.total ?? 0} onChange={setCartPage} />
            </>
          )}
        </Modal>
      )}

      {createOpen && (
        <Modal
          title="保存逻辑数据集"
          onClose={() => setCreateOpen(false)}
          footer={
            <div className="actions">
              <Button onClick={() => setCreateOpen(false)}>取消</Button>
              <Button
                variant="primary"
                loading={createDataset.isPending}
                disabled={!datasetName.trim() || selectedCount === 0 || isSyncing}
                onClick={() => createDataset.mutate()}
              >
                保存到数据库
              </Button>
            </div>
          }
        >
          <ErrorNotice error={createDataset.error} />
          <p className="subtle">保存 {selectedCount.toLocaleString()} 个电池成员；不会复制或移动原始文件。</p>
          <FormControl required>
            <FormControl.Label>逻辑数据集名称</FormControl.Label>
            <TextInput
              autoFocus
              block
              maxLength={200}
              placeholder="例如：NASA 与 CALCE 混合子集"
              value={datasetName}
              onChange={(event) => setDatasetName(event.target.value)}
            />
          </FormControl>
          <FormControl>
            <FormControl.Label>备注</FormControl.Label>
            <TextInput
              block
              maxLength={2000}
              placeholder="可选"
              value={datasetDescription}
              onChange={(event) => setDatasetDescription(event.target.value)}
            />
          </FormControl>
          <div className="cart-source-summary">
            {selectionRows.map((item) => {
              const source = sources.find((candidate) => candidate.id === item.source_id)
              const count = item.include_all
                ? Math.max(
                    0,
                    (source?.available_battery_count ?? 0) - (item.excluded_battery_ids?.length ?? 0),
                  )
                : (item.battery_ids?.length ?? 0)
              return (
                <div className="cart-source-row" key={item.source_id}>
                  <span>{source?.name ?? "已移除的数据集"}</span>
                  <strong>{count.toLocaleString()}</strong>
                </div>
              )
            })}
          </div>
        </Modal>
      )}

      {detail && <BatteryDetails id={detail} sources={sources} onClose={() => setDetail(null)} />}
      {datasetDetail && (
        <LogicalDatasetDetails
          id={datasetDetail}
          onClose={() => setDatasetDetail(null)}
          onCreateSplit={(id) => navigate(`/splits?create=1&logical_dataset_id=${encodeURIComponent(id)}`)}
        />
      )}
    </div>
  )
}

function SelectionCartBar({
  count,
  sourceCount,
  onOpen,
  onClear,
  onCreateDataset,
  onCreateSplit,
}: {
  count: number
  sourceCount: number
  onOpen: () => void
  onClear: () => void
  onCreateDataset?: () => void
  onCreateSplit?: () => void
}) {
  return (
    <section className="selection-cart-bar" aria-label="已选电池">
      <div className="selection-cart-summary">
        <strong>选择篮</strong>
        <span>{count.toLocaleString()} 个电池</span>
        <span>{sourceCount} 个物理数据集</span>
      </div>
      <div className="actions">
        <Button size="small" onClick={onOpen}>
          查看成员
        </Button>
        <Button size="small" variant="invisible" onClick={onClear}>
          清空
        </Button>
        {onCreateDataset && (
          <Button size="small" leadingVisual={PlusIcon} onClick={onCreateDataset}>
            保存为逻辑数据集
          </Button>
        )}
        {onCreateSplit && (
          <Button size="small" variant="primary" onClick={onCreateSplit}>
            创建数据划分
          </Button>
        )}
      </div>
    </section>
  )
}

function CartMember({
  battery,
  source,
  onRemove,
}: {
  battery: Battery
  source?: DataSource
  onRemove: () => void
}) {
  return (
    <div className="cart-member-row">
      <div>
        <strong>{battery.file_name}</strong>
        <span>{source?.name ?? battery.relative_key}</span>
      </div>
      <Button size="small" variant="invisible" leadingVisual={TrashIcon} onClick={onRemove}>
        移除
      </Button>
    </div>
  )
}

function LogicalDatasetList({
  query,
  onOpen,
  onDelete,
  deleting,
  deleteError,
}: {
  query: ReturnType<typeof useQuery<Schema["Page_LogicalDataset_"]>>
  onOpen: (id: string) => void
  onDelete: (dataset: Schema["LogicalDataset"]) => void
  deleting: boolean
  deleteError: unknown
}) {
  return (
    <section className="logical-datasets-section">
      <ErrorNotice error={query.error ?? deleteError} />
      {query.isPending ? (
        <Loading />
      ) : !query.data?.items.length ? (
        <Empty title="还没有逻辑数据集">
          <p>从物理数据集打开文件夹，选择电池后保存为逻辑数据集。</p>
        </Empty>
      ) : (
        <div className="logical-dataset-list">
          {query.data.items.map((dataset) => (
            <article className="logical-dataset-row" key={dataset.id}>
              <div className="logical-dataset-main">
                <button
                  className="text-link logical-dataset-name"
                  type="button"
                  onClick={() => onOpen(dataset.id)}
                >
                  {dataset.name}
                </button>
                <span>
                  {dataset.member_count.toLocaleString()} 个电池 · {dataset.source_snapshot.length} 个来源
                </span>
                {dataset.description && <p>{dataset.description}</p>}
              </div>
              <span className={`freshness-badge ${dataset.stale ? "is-stale" : ""}`}>
                {dataset.stale ? "来源已更新" : "当前"}
              </span>
              <Button size="small" onClick={() => onOpen(dataset.id)}>
                查看
              </Button>
              <Button
                size="small"
                variant="invisible"
                loading={deleting}
                leadingVisual={TrashIcon}
                onClick={() => onDelete(dataset)}
              >
                删除
              </Button>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function LogicalDatasetDetails({
  id,
  onClose,
  onCreateSplit,
}: {
  id: string
  onClose: () => void
  onCreateSplit: (id: string) => void
}) {
  const [page, setPage] = useState(1)
  const dataset = useQuery({
    queryKey: ["logical-dataset", id],
    queryFn: ({ signal }) => api.logicalDataset(id, signal),
  })
  const members = useQuery({
    queryKey: ["logical-dataset-members", id, page],
    queryFn: ({ signal }) => api.logicalDatasetMembers(id, page, signal),
    placeholderData: keepPreviousData,
  })
  return (
    <Modal
      title={dataset.data?.name ?? "逻辑数据集"}
      onClose={onClose}
      wide
      footer={
        <div className="actions">
          <Button onClick={onClose}>关闭</Button>
          <span className="grow" />
          <Button variant="primary" disabled={dataset.data?.stale} onClick={() => onCreateSplit(id)}>
            创建数据划分
          </Button>
        </div>
      }
    >
      <ErrorNotice error={dataset.error ?? members.error} />
      {dataset.isPending ? (
        <Loading />
      ) : dataset.data ? (
        <>
          <Details
            values={{
              成员: dataset.data.member_count.toLocaleString(),
              来源: dataset.data.source_snapshot
                .map((item) => String(item.source_name ?? "数据集"))
                .join("、"),
              状态: dataset.data.stale ? "物理数据发生变化，请重新选择保存" : "当前",
              创建时间: date(dataset.data.created_at),
              备注: dataset.data.description || "—",
            }}
          />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>电池文件</th>
                  <th>化学体系</th>
                  <th>容量</th>
                  <th>温度</th>
                  <th>文件状态</th>
                </tr>
              </thead>
              <tbody>
                {members.data?.items.map((battery) => (
                  <tr key={battery.id}>
                    <td>{battery.file_name}</td>
                    <td>{display(battery.metadata.chemistry)}</td>
                    <td>{number(battery.metadata.nominal_capacity_ah)} Ah</td>
                    <td>{number(battery.metadata.temperature_c)} °C</td>
                    <td>{battery.availability === "available" ? "可用" : "已移除"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} size={50} total={members.data?.total ?? 0} onChange={setPage} />
        </>
      ) : null}
    </Modal>
  )
}

function BatteryDetails({
  id,
  sources,
  onClose,
}: {
  id: string
  sources: DataSource[]
  onClose: () => void
}) {
  const query = useQuery({ queryKey: ["battery", id], queryFn: ({ signal }) => api.battery(id, signal) })
  const battery = query.data
  const numbers = Object.entries(battery?.metadata ?? {}).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number",
  )
  const sequences = Object.entries(battery?.metadata ?? {}).filter(
    (entry): entry is [string, number[]] =>
      Array.isArray(entry[1]) && entry[1].length > 0 && entry[1].every((value) => typeof value === "number"),
  )
  return (
    <Modal title={battery?.file_name ?? "电池详情"} onClose={onClose} wide>
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <Loading />
      ) : (
        battery && (
          <>
            <Details
              values={{
                来源: sources.find((item) => item.id === battery.source_id)?.name,
                路径: battery.relative_key,
                状态: battery.availability === "available" ? "可用" : battery.availability,
                文件大小: battery.file_size_bytes
                  ? `${(battery.file_size_bytes / 1024 / 1024).toFixed(2)} MB`
                  : "—",
                最近修改: battery.modified_at_ns
                  ? date(new Date(battery.modified_at_ns / 1_000_000).toISOString())
                  : "—",
                登记时间: date(battery.created_at),
              }}
            />
            <h3>统计特征</h3>
            {numbers.length ? (
              <div className="stat-strip">
                {numbers.map(([key, value]) => (
                  <div key={key}>
                    <span>{metadataNames[key] ?? key}</span>
                    <strong>{number(value)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="subtle">此文件尚无登记的数值统计特征。</p>
            )}
            {sequences.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>统计序列</th>
                      <th>样本数</th>
                      <th>最小值</th>
                      <th>最大值</th>
                      <th>均值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sequences.map(([key, values]) => (
                      <tr key={key}>
                        <td>{metadataNames[key] ?? key}</td>
                        <td>{values.length}</td>
                        <td>{number(Math.min(...values))}</td>
                        <td>{number(Math.max(...values))}</td>
                        <td>{number(values.reduce((sum, value) => sum + value / values.length, 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )
      )}
    </Modal>
  )
}
