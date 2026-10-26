import { DownloadIcon, PlusIcon } from "@primer/octicons-react"
import { Button, Checkbox, FormControl, Select, TextInput } from "@primer/react"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { api, download } from "../api/client"
import type { Battery, Schema, Split, SplitWrite } from "../api/types"
import { useSelection } from "../app/context"
import { BatteryExplorer } from "../components/battery-explorer"
import { Details, Empty, ErrorNotice, Loading, Modal, PageHeader, Pager } from "../components/common"
import { date, partitions } from "../lib/format"
import { countSelection, includes, type Selection } from "../lib/selection"

async function collectRows(selection: Selection): Promise<Battery[]> {
  const ids = Object.keys(selection),
    rows: Battery[] = []
  let page = 1
  while (true) {
    const result = await api.batteries({ source_ids: ids, page, page_size: 200 })
    rows.push(...result.items)
    if (rows.length >= result.total) return rows.filter((row) => includes(selection, row))
    if (!result.items.length) throw new Error("目录已变化，请重新选择电池")
    page += 1
  }
}

async function collectLogicalRows(id: string): Promise<Battery[]> {
  const rows: Battery[] = []
  let page = 1
  while (true) {
    const result = await api.logicalDatasetMembers(id, page)
    rows.push(...result.items)
    if (rows.length >= result.total) return rows
    if (!result.items.length) throw new Error("逻辑数据集成员已变化，请重新打开")
    page += 1
  }
}

async function collectSplitRows(id: string) {
  const rows: Battery[] = [],
    assigned: Record<string, "train" | "val" | "test"> = {}
  for (const partition of partitions) {
    let page = 1
    while (true) {
      const result = await api.splitMembers(id, partition, page)
      rows.push(...result.items)
      for (const item of result.items) assigned[item.id] = partition
      if (!result.items.length || page * 100 >= result.total) break
      page += 1
    }
  }
  return { rows, assigned }
}

export default function SplitsPage() {
  const [params, setParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [importOpen, setImportOpen] = useState(false)
  const query = useQuery({
    queryKey: ["splits", page, search],
    queryFn: ({ signal }) => api.splits({ page, page_size: 30, q: search }, signal),
    placeholderData: keepPreviousData,
  })
  if (params.has("create"))
    return (
      <SplitWizard
        close={() => setParams({})}
        logicalDatasetId={params.get("logical_dataset_id") ?? undefined}
      />
    )
  if (params.get("edit"))
    return <SplitWizard close={() => setParams({})} editSplitId={params.get("edit") ?? undefined} />
  return (
    <>
      <PageHeader
        title="数据划分"
        description="把选中的电池分为训练、验证和测试集合。"
        actions={
          <Button as={Link} to="/batteries">
            浏览电池
          </Button>
        }
      />
      <div className="toolbar">
        <TextInput
          aria-label="搜索划分"
          placeholder="搜索划分名称…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
        />
        <Button onClick={() => setImportOpen(true)}>导入 JSON</Button>
        <Button leadingVisual={PlusIcon} variant="primary" onClick={() => setParams({ create: "1" })}>
          新建数据集
        </Button>
      </div>
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <Loading />
      ) : !query.data?.items.length ? (
        <Empty title="还没有可用的数据集">
          <p>直接选择电池并分配训练、验证和测试数据，或导入已有划分 JSON。</p>
          <Button variant="primary" onClick={() => setParams({ create: "1" })}>
            新建数据集
          </Button>
        </Empty>
      ) : (
        <div className="split-list">
          {query.data.items.map((split) => (
            <div className="split-row" key={split.id}>
              <div className="split-info">
                <button className="text-link" type="button" onClick={() => setParams({ open: split.id })}>
                  {split.name}
                </button>
                <div className="subtle">
                  v{split.version} · {date(split.created_at)} ·{" "}
                  {Object.values(split.counts)
                    .reduce((a, b) => a + b, 0)
                    .toLocaleString()}{" "}
                  个电池
                  {split.origin === "builtin" && " · 内置"}
                  {!split.execution_ready && " · 尚不可训练"}
                </div>
              </div>
              <span className="subtle">
                {split.counts.train} / {split.counts.val} / {split.counts.test}
              </span>
              <Button size="small" onClick={() => setParams({ open: split.id })}>
                详情
              </Button>
            </div>
          ))}
          <Pager page={page} size={30} total={query.data.total} onChange={setPage} />
        </div>
      )}
      {params.get("open") && <SplitDetails id={params.get("open") ?? ""} close={() => setParams({})} />}
      {importOpen && <SplitImport onClose={() => setImportOpen(false)} />}
    </>
  )
}

function SplitDetails({ id, close }: { id: string; close: () => void }) {
  const navigate = useNavigate(),
    client = useQueryClient()
  const split = useQuery({ queryKey: ["split", id], queryFn: ({ signal }) => api.split(id, signal) })
  const sources = useQuery({ queryKey: ["sources"], queryFn: ({ signal }) => api.sources(signal) })
  const [partition, setPartition] = useState("train"),
    [page, setPage] = useState(1),
    [showMembers, setShowMembers] = useState(false),
    [memberSearch, setMemberSearch] = useState("")
  const members = useQuery({
    queryKey: ["split-members", id, partition, page, memberSearch],
    enabled: showMembers,
    queryFn: ({ signal }) => api.splitMembers(id, partition, page, memberSearch, signal),
  })
  const manifestMemberNames = providerPartitionMembers(split.data?.payload, partition)
  const partitionIssues = (split.data?.resolution.issues ?? []).filter(
    (issue) => issue.status !== "empty_partition" && manifestMemberNames.includes(issue.file_name),
  )
  const visiblePartitionIssues = partitionIssues.filter((issue) =>
    issue.file_name.toLocaleLowerCase().includes(memberSearch.trim().toLocaleLowerCase()),
  )
  const unavailableOnPage =
    members.data?.items.filter((item) => item.availability !== "available").length ?? 0
  const visibleProblemCount = unavailableOnPage + visiblePartitionIssues.length
  const remove = useMutation({
    mutationFn: () => api.deleteSplit(id),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["splits"] })
      close()
    },
  })
  const exportFile = useMutation({
    mutationFn: () =>
      download("/splits/" + encodeURIComponent(id) + "/export", (split.data?.name ?? "split") + ".json"),
  })
  return (
    <Modal
      title={split.data?.name ?? "划分详情"}
      onClose={close}
      wide
      footer={
        <div className="actions">
          <Button
            variant="danger"
            disabled={split.data?.read_only}
            loading={remove.isPending}
            onClick={() => {
              if (window.confirm("删除此数据划分？已被实验引用的版本将由后端保护。")) remove.mutate()
            }}
          >
            删除
          </Button>
          <span className="grow" />
          <Button leadingVisual={DownloadIcon} onClick={() => exportFile.mutate()}>
            导出 JSON
          </Button>
          <Button
            disabled={split.data?.read_only}
            onClick={() => navigate(`/splits?edit=${encodeURIComponent(id)}`)}
          >
            编辑数据集
          </Button>
          <Button
            variant="primary"
            disabled={!split.data?.execution_ready}
            onClick={() =>
              navigate("/experiments/new", { state: { splitId: id, splitVersion: split.data?.version } })
            }
          >
            用于新实验
          </Button>
        </div>
      }
    >
      <ErrorNotice error={split.error ?? remove.error ?? exportFile.error} />
      {split.isPending ? (
        <Loading />
      ) : (
        split.data && (
          <>
            <Details
              values={{
                版本: "v" + split.data.version,
                类型:
                  split.data.origin === "builtin"
                    ? "内置数据集"
                    : split.data.origin === "imported"
                      ? "导入的数据集"
                      : "自建数据集",
                来源: split.data.sources
                  .map(
                    (source) =>
                      sources.data?.items.find((item) => item.id === source.source_id)?.name ?? "数据来源",
                  )
                  .join(" + "),
                创建时间: date(split.data.created_at),
                训练集: split.data.counts.train,
                验证集: split.data.counts.val,
                测试集: split.data.counts.test,
              }}
            />
            {!split.data.execution_ready && (
              <div className="notice error split-readiness-notice" role="status">
                <div>
                  <strong>当前无法用于训练</strong>
                  <p>
                    {split.data.resolution.missing > 0 && `缺少 ${split.data.resolution.missing} 个文件。`}
                    {split.data.resolution.ambiguous > 0 &&
                      `有 ${split.data.resolution.ambiguous} 个文件名对应多个电池。`}
                    {split.data.resolution.duplicates > 0 &&
                      `有 ${split.data.resolution.duplicates} 个重复成员。`}
                    {split.data.resolution.manifest_missing && "内置划分清单已不存在。"}
                    {(split.data.resolution.issues ?? []).some(
                      (issue) => issue.status === "empty_partition",
                    ) && "存在空分组。"}
                  </p>
                  <span className="subtle">展开电池成员，可按训练、验证和测试分组定位问题文件。</span>
                </div>
              </div>
            )}
            <Statistics statistics={split.data.statistics} />
            <Button onClick={() => setShowMembers(!showMembers)}>
              {showMembers ? "隐藏成员" : "查看电池成员"}
            </Button>
            {showMembers && (
              <section className="member-inspector" aria-label="电池成员">
                <header className="member-inspector-heading">
                  <div>
                    <h3>电池成员</h3>
                    <p>按分组浏览文件；异常成员会标出原因和来源位置。</p>
                  </div>
                  <div className="member-inspector-meta">
                    <span className="subtle">{members.data?.total.toLocaleString() ?? "—"} 个已登记成员</span>
                    {members.data && (
                      <span className={`member-health${visibleProblemCount ? " has-problems" : ""}`}>
                        {visibleProblemCount > 0
                          ? `${visibleProblemCount} 个问题文件`
                          : members.data.total > 0
                            ? "未发现异常"
                            : "没有已登记成员"}
                      </span>
                    )}
                  </div>
                </header>
                <fieldset className="member-partition-tabs">
                  <legend className="sr-only">选择数据分组</legend>
                  {partitions.map((item) => {
                    const label = item === "train" ? "训练集" : item === "val" ? "验证集" : "测试集"
                    return (
                      <button
                        aria-pressed={partition === item}
                        className={`member-partition-tab${partition === item ? " is-active" : ""}`}
                        key={item}
                        onClick={() => {
                          setPartition(item)
                          setPage(1)
                        }}
                        type="button"
                      >
                        <span>{label}</span>
                        <strong>{(split.data?.counts[item] ?? 0).toLocaleString()}</strong>
                      </button>
                    )
                  })}
                </fieldset>
                <div className="member-list-toolbar">
                  <TextInput
                    aria-label="搜索电池成员"
                    placeholder="按文件名或路径搜索…"
                    value={memberSearch}
                    onChange={(event) => {
                      setMemberSearch(event.target.value)
                      setPage(1)
                    }}
                  />
                  <span className="subtle">{members.data?.total.toLocaleString() ?? "—"} 项匹配</span>
                </div>
                <ErrorNotice error={members.error} />
                {members.isPending ? (
                  <Loading />
                ) : (
                  <>
                    {visiblePartitionIssues.length > 0 && (
                      <div className="member-issue-list" role="alert">
                        <div className="member-issue-heading">
                          <strong>未匹配的清单文件</strong>
                          <span>{visiblePartitionIssues.length} 项需要处理</span>
                        </div>
                        {visiblePartitionIssues.map((issue) => (
                          <div
                            className={`member-issue-row member-issue--${issue.status === "ambiguous" ? "warning" : "error"}`}
                            key={`${issue.file_name}-${issue.status}`}
                          >
                            <code title={issue.file_name}>{issue.file_name}</code>
                            <span className="member-status-label">{resolutionLabel(issue.status)}</span>
                            {issue.candidates && issue.candidates.length > 0 && (
                              <small>
                                候选来源：
                                {issue.candidates
                                  .map((candidate) => `${candidate.source_name} · ${candidate.relative_key}`)
                                  .join(" / ")}
                              </small>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {members.data?.items.length ? (
                      <div className="member-table-wrap">
                        <table className="member-table">
                          <thead>
                            <tr>
                              <th scope="col">#</th>
                              <th scope="col">电池文件</th>
                              <th scope="col">数据来源</th>
                              <th scope="col">状态</th>
                            </tr>
                          </thead>
                          <tbody>
                            {members.data.items.map((item, index) => {
                              const statusKind =
                                item.availability === "available"
                                  ? "available"
                                  : item.availability === "missing"
                                    ? "missing"
                                    : "warning"
                              const sourceName =
                                sources.data?.items.find((source) => source.id === item.source_id)?.name ??
                                "未知来源"
                              return (
                                <tr className={`member-table-row is-${statusKind}`} key={item.id}>
                                  <td className="member-row-number">
                                    {((page - 1) * 100 + index + 1).toLocaleString()}
                                  </td>
                                  <td>
                                    <code className="member-file-name" title={item.file_name}>
                                      {item.file_name}
                                    </code>
                                    <small className="member-file-path" title={item.relative_key}>
                                      {item.relative_key}
                                    </small>
                                  </td>
                                  <td className="member-source-name">{sourceName}</td>
                                  <td>
                                    <span className={`member-status is-${statusKind}`}>
                                      {item.availability === "available"
                                        ? "可用"
                                        : item.availability === "missing"
                                          ? "文件不存在"
                                          : `状态异常 · ${item.availability}`}
                                    </span>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : visiblePartitionIssues.length === 0 ? (
                      <div className="member-empty">
                        {memberSearch ? "没有匹配的电池文件。" : "此分组没有已登记的电池文件。"}
                      </div>
                    ) : null}
                    {(members.data?.total ?? 0) > 100 && (
                      <Pager page={page} size={100} total={members.data?.total ?? 0} onChange={setPage} />
                    )}
                  </>
                )}
              </section>
            )}
          </>
        )
      )}
    </Modal>
  )
}

function resolutionLabel(status: string): string {
  return (
    {
      missing: "未找到文件",
      ambiguous: "文件名对应多个电池",
      duplicate_member: "文件重复出现在多个分组",
      empty_partition: "分组为空",
    }[status] ?? status
  )
}

function providerPartitionMembers(payload: Split["payload"], partition: string): string[] {
  const providerSplit = payload?.provider_split
  if (!providerSplit || typeof providerSplit !== "object" || Array.isArray(providerSplit)) return []
  const members = (providerSplit as Record<string, unknown>)[partition]
  return Array.isArray(members) ? members.filter((name): name is string => typeof name === "string") : []
}

function uniqueIssues(issues: Schema["ImportIssue"][]): Schema["ImportIssue"][] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = [
      issue.file_name,
      issue.status,
      issue.partition ?? "",
      (issue.candidates ?? []).map((candidate) => candidate.battery_id).join(","),
    ].join(":")
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function SplitImport({ onClose }: { onClose: () => void }) {
  const client = useQueryClient(),
    navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [bindings, setBindings] = useState<Record<string, string>>({})
  const preview = useMutation({
    mutationFn: (data: { file: File; bindings: Record<string, string> }) =>
      api.previewSplitImport(data.file, data.bindings),
  })
  const save = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("请选择划分 JSON 文件")
      return api.importSplit(file, bindings)
    },
    onSuccess: (split) => {
      client.invalidateQueries({ queryKey: ["splits"] })
      onClose()
      navigate(`/splits?open=${encodeURIComponent(split.id)}`)
    },
  })
  const issues = preview.data?.resolution.issues ?? []
  const ambiguous = issues.filter((issue) => issue.status === "ambiguous")
  const bindingComplete = ambiguous.every((issue) => Boolean(bindings[issue.file_name]))
  const canSave = Boolean(preview.data?.execution_ready && bindingComplete && !preview.isPending)
  return (
    <Modal
      title="导入训练数据集"
      onClose={onClose}
      wide
      footer={
        <div className="actions">
          <Button onClick={onClose}>取消</Button>
          <span className="grow" />
          <Button
            variant="primary"
            disabled={!canSave || save.isPending}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            导入数据集
          </Button>
        </div>
      }
    >
      <p className="subtle">
        上传包含 dataset、train、val、test 的 JSON。系统会在所有已索引来源中匹配文件名。
      </p>
      <label className="form-stack">
        <span>划分 JSON</span>
        <input
          type="file"
          accept=".json,application/json"
          onChange={(event) => {
            const next = event.target.files?.[0] ?? null
            setFile(next)
            setBindings({})
            preview.reset()
            if (next) preview.mutate({ file: next, bindings: {} })
          }}
        />
      </label>
      <ErrorNotice error={preview.error ?? save.error} />
      {preview.data && (
        <>
          <Details
            values={{
              数据集: preview.data.name,
              电池数量: Object.values(preview.data.counts).reduce((sum, count) => sum + count, 0),
              匹配: preview.data.resolution.matched,
              重名待确认: preview.data.resolution.ambiguous,
              未找到: preview.data.resolution.missing,
            }}
          />
          {ambiguous.length > 0 && (
            <section className="form-stack" aria-label="确认同名文件来源">
              <h3>确认重名文件</h3>
              <p className="subtle">每个文件名对应多个来源，请选择划分 JSON 实际指向的电池。</p>
              {ambiguous.map((issue) => (
                <FormControl key={issue.file_name}>
                  <FormControl.Label>{issue.file_name}</FormControl.Label>
                  <Select
                    aria-label={`选择 ${issue.file_name} 的匹配电池`}
                    value={bindings[issue.file_name] ?? ""}
                    onChange={(event) => {
                      const next = { ...bindings, [issue.file_name]: event.target.value }
                      setBindings(next)
                      if (file) preview.mutate({ file, bindings: next })
                    }}
                  >
                    <Select.Option value="">选择来源…</Select.Option>
                    {issue.candidates?.map((candidate) => (
                      <Select.Option key={candidate.battery_id} value={candidate.battery_id}>
                        {candidate.source_name} · {candidate.relative_key}
                      </Select.Option>
                    ))}
                  </Select>
                </FormControl>
              ))}
            </section>
          )}
          {issues.some((issue) => issue.status !== "ambiguous") && (
            <section className="form-stack">
              <h3>需要修正的内容</h3>
              <ul>
                {uniqueIssues(issues.filter((issue) => issue.status !== "ambiguous")).map((issue) => (
                  <li key={`${issue.file_name}-${issue.status}-${issue.partition ?? ""}`}>
                    {issue.file_name || issue.partition || "数据文件"} · {resolutionLabel(issue.status)}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {preview.data.execution_ready ? (
            <div className="notice success" role="status">
              所有成员已唯一匹配，可以导入。
            </div>
          ) : (
            <div className="notice error" role="status">
              先处理重名、缺失文件或空分组后才能导入训练数据集。
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

function Statistics({ statistics }: { statistics: Schema["DatasetStatistics"] | null | undefined }) {
  const [scope, setScope] = useState<"all" | "train" | "val" | "test">("all")
  if (!statistics) return <p className="subtle">尚无预计算统计特征。</p>
  const values = statistics.scopes[scope]
  return (
    <div>
      <div className="tabs" role="tablist" aria-label="统计范围">
        {(["all", ...partitions] as const).map((key) => (
          <button
            type="button"
            role="tab"
            aria-selected={scope === key}
            key={key}
            onClick={() => setScope(key)}
          >
            {key === "all" ? "全部" : key === "train" ? "训练集" : key === "val" ? "验证集" : "测试集"}
          </button>
        ))}
      </div>
      <p className="subtle">{values.sample_count.toLocaleString()} 个样本</p>
      {Object.keys(values.attributes).length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>属性</th>
                <th>分布或范围</th>
                <th>有效</th>
                <th>缺失</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(values.attributes).map(([name, value]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>
                    {value.kind === "numeric"
                      ? "均值 " +
                        (value.mean ?? "—") +
                        " · " +
                        (value.min ?? "—") +
                        " – " +
                        (value.max ?? "—")
                      : (value.categories
                          ?.map((item) => String(item.value) + " (" + item.count + ")")
                          .join(" · ") ?? "—")}
                  </td>
                  <td>{value.valid_count}</td>
                  <td>{value.missing_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="subtle">没有已登记的属性。</p>
      )}
    </div>
  )
}

function SplitWizard({
  close,
  logicalDatasetId,
  editSplitId,
}: {
  close: () => void
  logicalDatasetId?: string
  editSplitId?: string
}) {
  const navigate = useNavigate(),
    client = useQueryClient()
  const { value: selection, setValue: setSelection } = useSelection()
  const sourcesQuery = useQuery({ queryKey: ["sources"], queryFn: ({ signal }) => api.sources(signal) })
  const logicalDataset = useQuery({
    queryKey: ["logical-dataset", logicalDatasetId],
    queryFn: ({ signal }) => api.logicalDataset(logicalDatasetId ?? "", signal),
    enabled: Boolean(logicalDatasetId),
  })
  const editSplit = useQuery({
    queryKey: ["split", editSplitId],
    queryFn: ({ signal }) => api.split(editSplitId ?? "", signal),
    enabled: Boolean(editSplitId),
  })
  const editInitialized = useRef(false)
  const sources = sourcesQuery.data?.items ?? []
  const [step, setStep] = useState(editSplitId || logicalDatasetId ? 1 : 0),
    [name, setName] = useState(""),
    [manual, setManual] = useState(Boolean(editSplitId)),
    [fillRest, setFillRest] = useState(!editSplitId)
  const [train, setTrain] = useState(70),
    [val, setVal] = useState(15),
    [seed, setSeed] = useState(42)
  const [rows, setRows] = useState<Battery[]>([]),
    [assigned, setAssigned] = useState<Record<string, "train" | "val" | "test">>({})
  const total = editSplitId
    ? rows.length
    : logicalDatasetId
      ? (logicalDataset.data?.member_count ?? 0)
      : countSelection(selection, sources)
  const [marked, setMarked] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1)
  const [preview, setPreview] = useState<{
    body: SplitWrite
    counts: Schema["SplitPreviewCounts"]
    execution_ready: boolean
    resolution: Schema["ImportResolution"]
  } | null>(null)
  const expand = useMutation({
    mutationFn: async () => {
      if (editSplitId) return collectSplitRows(editSplitId)
      const items = logicalDatasetId
        ? await collectLogicalRows(logicalDatasetId)
        : await collectRows(selection)
      return { rows: items, assigned: {} as Record<string, "train" | "val" | "test"> }
    },
    onSuccess: ({ rows: items, assigned: initialAssignments }) => {
      setRows(items)
      setManual(true)
      setAssigned(initialAssignments)
      setMarked([])
    },
  })
  useEffect(() => {
    if (!editSplitId || !editSplit.data || editInitialized.current) return
    editInitialized.current = true
    setName(editSplit.data.name)
    setFillRest(false)
    expand.mutate()
  }, [editSplitId, editSplit.data, expand.mutate])
  const previewMutation = useMutation({
    mutationFn: async () => {
      const partitionsBody = { train: [] as string[], val: [] as string[], test: [] as string[] }
      for (const [id, part] of Object.entries(assigned)) partitionsBody[part].push(id)
      const method =
        manual && !fillRest ? "manual" : manual && Object.keys(assigned).length ? "hybrid" : "random"
      const sourceSelections = editSplitId
        ? [...new Set(rows.map((item) => item.source_id))].map((sourceId) => {
            const source = sources.find((item) => item.id === sourceId)
            if (!source) throw new Error("数据来源已变化，请重新打开划分")
            return {
              source_id: sourceId,
              expected_revision: source.revision,
              include_all: false,
              battery_ids: rows.filter((item) => item.source_id === sourceId).map((item) => item.id),
            }
          })
        : Object.values(selection).map((item) =>
            item.include_all && manual
              ? {
                  ...item,
                  include_all: false,
                  battery_ids: rows
                    .filter((battery) => battery.source_id === item.source_id)
                    .map((battery) => battery.id),
                  excluded_battery_ids: [],
                }
              : item,
          )
      const body: SplitWrite = {
        name: name.trim() || "新数据划分",
        source_selections: logicalDatasetId ? [] : sourceSelections,
        ...(logicalDatasetId ? { logical_dataset_id: logicalDatasetId } : {}),
        method,
        ...(method === "manual"
          ? {}
          : { ratios: { train: train / 100, val: val / 100, test: (100 - train - val) / 100 }, seed }),
        partitions: partitionsBody,
      }
      const result = await api.previewSplit(body)
      return {
        body,
        counts: result.counts,
        execution_ready: result.execution_ready,
        resolution: result.resolution,
      }
    },
    onSuccess: (result) => {
      setPreview(result)
      if (!name.trim()) setName("实验数据划分")
      setStep(2)
    },
  })
  const save = useMutation({
    mutationFn: () => {
      if (!preview || !name.trim()) throw new Error("请填写名称并预览划分")
      const body = { ...preview.body, name: name.trim() }
      return editSplitId && editSplit.data
        ? api.updateSplit(editSplitId, { ...body, expected_revision: editSplit.data.revision })
        : api.createSplit(body)
    },
    onSuccess: (split) => {
      client.setQueryData(["split", split.id], split)
      client.invalidateQueries({ queryKey: ["splits"] })
      if (!logicalDatasetId && !editSplitId) setSelection({})
      navigate("/splits?open=" + split.id)
    },
  })
  const filtered = rows.filter((item) => item.file_name.toLowerCase().includes(search.toLowerCase()))
  const visible = filtered.slice((page - 1) * 60, page * 60)
  function assign(ids: string[], part: "train" | "val" | "test" | "auto") {
    setAssigned((old) => {
      const next = { ...old }
      for (const id of ids) {
        if (part === "auto") delete next[id]
        else next[id] = part
      }
      return next
    })
  }
  return (
    <>
      <PageHeader
        title={editSplitId ? "编辑数据集划分" : "新建数据集"}
        description={
          editSplitId
            ? "调整已有数据集的分组并保存为新版本。"
            : "选择电池、设定分组并查看后端计算的实际数量。"
        }
        actions={<Button onClick={close}>返回</Button>}
      />
      <nav className="stepper" aria-label="创建划分步骤">
        {["选择电池", "设置分组", "预览保存"].map((label, index) => (
          <button
            key={label}
            type="button"
            aria-current={step === index ? "step" : undefined}
            disabled={index > step || (Boolean(editSplitId) && index === 0)}
            onClick={() => setStep(index)}
          >
            <span className="step-number">{index + 1}</span>
            {label}
          </button>
        ))}
      </nav>
      <ErrorNotice
        error={
          sourcesQuery.error ??
          logicalDataset.error ??
          editSplit.error ??
          expand.error ??
          previewMutation.error ??
          save.error
        }
      />
      {logicalDatasetId && logicalDataset.data?.stale && (
        <div className="notice error" role="alert">
          逻辑数据集使用的物理数据源已更新。请返回电池目录重新保存逻辑数据集后再创建划分。
        </div>
      )}
      {step === 0 && (
        <BatteryExplorer selection={selection} setSelection={setSelection} allowLogicalDataset={false} />
      )}
      {step === 1 && (
        <div className="editor-narrow form-stack">
          <div className="section-title">
            <div>
              <h2>{total.toLocaleString()} 个已选电池</h2>
              {logicalDataset.data && <p className="subtle">来自逻辑数据集：{logicalDataset.data.name}</p>}
            </div>
            <div className="actions">
              <Button size="small" aria-pressed={!manual} onClick={() => setManual(false)}>
                按比例
              </Button>
              <Button
                size="small"
                aria-pressed={manual}
                loading={expand.isPending}
                onClick={() => expand.mutate()}
              >
                指定部分电池
              </Button>
            </div>
          </div>
          {!manual && (
            <>
              <p className="subtle">默认按比例随机分配。相关电池保持在同一分组，人数按后端规则计算。</p>
              <div className="actions">
                <span className="subtle">常用比例</span>
                {[
                  [70, 15],
                  [80, 10],
                  [80, 0],
                ].map(([a, b]) => (
                  <Button
                    key={a + "-" + b}
                    size="small"
                    onClick={() => {
                      setTrain(a)
                      setVal(b)
                    }}
                  >
                    {a}/{b}/{100 - a - b}
                  </Button>
                ))}
              </div>
              <div className="ratio-bar">
                {[
                  ["train", train],
                  ["val", val],
                  ["test", 100 - train - val],
                ].map(([part, value]) => (
                  <div
                    className={"partition-" + part}
                    key={String(part)}
                    style={{ width: String(value) + "%" }}
                  >
                    {Number(value) > 0
                      ? (part === "train" ? "训练" : part === "val" ? "验证" : "测试") + " " + value + "%"
                      : ""}
                  </div>
                ))}
              </div>
              <div className="ratio-controls">
                <div>
                  <label className="range-label" htmlFor="train-ratio">
                    训练集 <span className="ratio-number">{train}%</span>
                  </label>
                  <input
                    id="train-ratio"
                    type="range"
                    min="0"
                    max="100"
                    value={train}
                    onChange={(event) => {
                      const n = Number(event.target.value)
                      setTrain(n)
                      if (val > 100 - n) setVal(100 - n)
                    }}
                  />
                </div>
                <div>
                  <label className="range-label" htmlFor="val-ratio">
                    验证集 <span className="ratio-number">{val}%</span>
                  </label>
                  <input
                    id="val-ratio"
                    type="range"
                    min="0"
                    max={100 - train}
                    value={val}
                    onChange={(event) => setVal(Number(event.target.value))}
                  />
                </div>
              </div>
              <FormControl>
                <FormControl.Label>随机种子</FormControl.Label>
                <TextInput
                  type="number"
                  min="0"
                  max="4294967295"
                  value={seed}
                  onChange={(event) => setSeed(Number(event.target.value))}
                />
                <FormControl.Caption>固定随机种子可以复现相同分组。</FormControl.Caption>
              </FormControl>
            </>
          )}
          {manual && (
            <>
              <div className="inline-check">
                <Checkbox
                  aria-label="未指定电池按比例分配"
                  checked={fillRest}
                  onChange={(event) => setFillRest(event.target.checked)}
                />
                <span>未指定电池按比例分配</span>
              </div>
              <div className="toolbar">
                <TextInput
                  aria-label="搜索电池成员"
                  placeholder="搜索文件名…"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setPage(1)
                  }}
                />
                <span>
                  已指定 {Object.keys(assigned).length} / {rows.length}
                </span>
              </div>
              <div className="actions">
                <Checkbox
                  aria-label="选择本页电池"
                  checked={visible.length > 0 && visible.every((item) => marked.includes(item.id))}
                  onChange={(event) =>
                    setMarked((old) =>
                      event.target.checked
                        ? [...new Set([...old, ...visible.map((item) => item.id)])]
                        : old.filter((id) => !visible.some((item) => item.id === id)),
                    )
                  }
                />
                <span className="subtle">选择电池，再指定分组</span>
                {partitions.map((part) => (
                  <Button
                    size="small"
                    key={part}
                    disabled={!marked.length}
                    onClick={() => {
                      assign(marked, part)
                      setMarked([])
                    }}
                  >
                    {part === "train" ? "训练集" : part === "val" ? "验证集" : "测试集"}
                  </Button>
                ))}
                <Button
                  size="small"
                  disabled={!marked.length}
                  onClick={() => {
                    assign(marked, "auto")
                    setMarked([])
                  }}
                >
                  取消指定
                </Button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th />
                      <th>电池文件</th>
                      <th>分组</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <Checkbox
                            aria-label={"选择 " + item.file_name}
                            checked={marked.includes(item.id)}
                            onChange={(event) =>
                              setMarked((old) =>
                                event.target.checked ? [...old, item.id] : old.filter((id) => id !== item.id),
                              )
                            }
                          />
                        </td>
                        <td>{item.file_name}</td>
                        <td>
                          <Select
                            aria-label={"分配 " + item.file_name}
                            value={assigned[item.id] ?? "auto"}
                            onChange={(event) =>
                              assign([item.id], event.target.value as "train" | "val" | "test" | "auto")
                            }
                          >
                            <Select.Option value="auto">按比例</Select.Option>
                            <Select.Option value="train">训练集</Select.Option>
                            <Select.Option value="val">验证集</Select.Option>
                            <Select.Option value="test">测试集</Select.Option>
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} size={60} total={filtered.length} onChange={setPage} />
            </>
          )}
        </div>
      )}
      {step === 2 && preview && (
        <div className="editor-narrow form-stack">
          <FormControl required>
            <FormControl.Label>划分名称</FormControl.Label>
            <TextInput block maxLength={200} value={name} onChange={(event) => setName(event.target.value)} />
          </FormControl>
          <div className="stat-strip">
            {partitions.map((part) => (
              <div key={part}>
                <span>{part === "train" ? "训练集" : part === "val" ? "验证集" : "测试集"}</span>
                <strong>{preview.counts[part].toLocaleString()}</strong>
              </div>
            ))}
          </div>
          <div className="ratio-bar">
            {partitions.map((part) => (
              <div
                className={"partition-" + part}
                key={part}
                style={{
                  width: (preview.counts.all ? (preview.counts[part] / preview.counts.all) * 100 : 0) + "%",
                }}
              >
                {preview.counts[part] ? part + " " + preview.counts[part] : ""}
              </div>
            ))}
          </div>
          <p className="subtle">保存后划分成员和预计算统计会随该版本保留。</p>
          {!preview.execution_ready && (
            <div className="notice error" role="status">
              当前分组包含空集合，仍可保存用于统计，但不能用于训练。请返回调整分组。
            </div>
          )}
        </div>
      )}
      <footer className="bottom-actions">
        <Button disabled={step === 0 || Boolean(editSplitId)} onClick={() => setStep(step - 1)}>
          上一步
        </Button>
        <div className="actions">
          <span className="selection-count">已选 {total.toLocaleString()} 个</span>
          {step === 0 ? (
            <Button variant="primary" disabled={!total} onClick={() => setStep(1)}>
              设置分组
            </Button>
          ) : step === 1 ? (
            <Button
              variant="primary"
              loading={previewMutation.isPending}
              disabled={
                !total || expand.isPending || (manual && !fillRest && Object.keys(assigned).length !== total)
              }
              onClick={() => previewMutation.mutate()}
            >
              预览划分
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={save.isPending}
              disabled={!name.trim()}
              onClick={() => save.mutate()}
            >
              {editSplitId ? "保存新版本" : "保存数据集"}
            </Button>
          )}
        </div>
      </footer>
    </>
  )
}
