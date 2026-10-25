import { DownloadIcon, PlusIcon } from "@primer/octicons-react"
import { Button, Checkbox, FormControl, Select, TextInput } from "@primer/react"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { api, download } from "../api/client"
import type { Battery, Schema, SplitWrite } from "../api/types"
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

export default function SplitsPage() {
  const [params, setParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
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
  return (
    <>
      <PageHeader
        title="数据划分"
        description="把选中的电池分为训练、验证和测试集合。"
        actions={
          <Button as={Link} to="/batteries">
            选择电池
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
        <Button leadingVisual={PlusIcon} variant="primary" onClick={() => setParams({ create: "1" })}>
          新建划分
        </Button>
      </div>
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <Loading />
      ) : !query.data?.items.length ? (
        <Empty title="还没有数据划分">
          <p>从电池目录选择数据，再创建一个逻辑数据集。</p>
          <Button variant="primary" onClick={() => setParams({ create: "1" })}>
            创建划分
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
    [showMembers, setShowMembers] = useState(false)
  const members = useQuery({
    queryKey: ["split-members", id, partition, page],
    enabled: showMembers,
    queryFn: ({ signal }) => api.splitMembers(id, partition, page, signal),
    placeholderData: keepPreviousData,
  })
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
            variant="primary"
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
            <Statistics statistics={split.data.statistics} />
            <Button onClick={() => setShowMembers(!showMembers)}>
              {showMembers ? "隐藏成员" : "查看电池成员"}
            </Button>
            {showMembers && (
              <>
                <Select
                  aria-label="电池分组"
                  value={partition}
                  onChange={(event) => {
                    setPartition(event.target.value)
                    setPage(1)
                  }}
                >
                  {partitions.map((item) => (
                    <Select.Option key={item} value={item}>
                      {item === "train" ? "训练集" : item === "val" ? "验证集" : "测试集"}
                    </Select.Option>
                  ))}
                </Select>
                <ErrorNotice error={members.error} />
                {members.isPending ? (
                  <Loading />
                ) : (
                  <>
                    <div className="compact-list">
                      {members.data?.items.map((item) => (
                        <div className="member-row" key={item.id}>
                          {item.file_name}
                          <span>{item.availability}</span>
                        </div>
                      ))}
                    </div>
                    <Pager page={page} size={100} total={members.data?.total ?? 0} onChange={setPage} />
                  </>
                )}
              </>
            )}
          </>
        )
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

function SplitWizard({ close, logicalDatasetId }: { close: () => void; logicalDatasetId?: string }) {
  const navigate = useNavigate(),
    client = useQueryClient()
  const { value: selection, setValue: setSelection } = useSelection()
  const sourcesQuery = useQuery({ queryKey: ["sources"], queryFn: ({ signal }) => api.sources(signal) })
  const logicalDataset = useQuery({
    queryKey: ["logical-dataset", logicalDatasetId],
    queryFn: ({ signal }) => api.logicalDataset(logicalDatasetId ?? "", signal),
    enabled: Boolean(logicalDatasetId),
  })
  const sources = sourcesQuery.data?.items ?? [],
    total = logicalDatasetId ? (logicalDataset.data?.member_count ?? 0) : countSelection(selection, sources)
  const [step, setStep] = useState(logicalDatasetId ? 1 : 0),
    [name, setName] = useState(""),
    [manual, setManual] = useState(false),
    [fillRest, setFillRest] = useState(true)
  const [train, setTrain] = useState(70),
    [val, setVal] = useState(15),
    [seed, setSeed] = useState(42)
  const [rows, setRows] = useState<Battery[]>([]),
    [assigned, setAssigned] = useState<Record<string, "train" | "val" | "test">>({})
  const [marked, setMarked] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1)
  const [preview, setPreview] = useState<{ body: SplitWrite; counts: Schema["SplitPreviewCounts"] } | null>(
    null,
  )
  const expand = useMutation({
    mutationFn: () => (logicalDatasetId ? collectLogicalRows(logicalDatasetId) : collectRows(selection)),
    onSuccess: (items) => {
      setRows(items)
      setManual(true)
      setAssigned({})
      setMarked([])
    },
  })
  const previewMutation = useMutation({
    mutationFn: async () => {
      const partitionsBody = { train: [] as string[], val: [] as string[], test: [] as string[] }
      for (const [id, part] of Object.entries(assigned)) partitionsBody[part].push(id)
      const method =
        manual && !fillRest ? "manual" : manual && Object.keys(assigned).length ? "hybrid" : "random"
      const sourceSelections = Object.values(selection).map((item) =>
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
      return { body, counts: result.counts }
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
      return api.createSplit({ ...preview.body, name: name.trim() })
    },
    onSuccess: (split) => {
      client.invalidateQueries({ queryKey: ["splits"] })
      if (!logicalDatasetId) setSelection({})
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
        title="新建数据划分"
        description="选择电池、设定分组并查看后端计算的实际数量。"
        actions={<Button onClick={close}>返回</Button>}
      />
      <nav className="stepper" aria-label="创建划分步骤">
        {["选择电池", "设置分组", "预览保存"].map((label, index) => (
          <button
            key={label}
            type="button"
            aria-current={step === index ? "step" : undefined}
            disabled={index > step}
            onClick={() => setStep(index)}
          >
            <span className="step-number">{index + 1}</span>
            {label}
          </button>
        ))}
      </nav>
      <ErrorNotice
        error={
          sourcesQuery.error ?? logicalDataset.error ?? expand.error ?? previewMutation.error ?? save.error
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
        </div>
      )}
      <footer className="bottom-actions">
        <Button disabled={step === 0} onClick={() => setStep(step - 1)}>
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
              保存划分
            </Button>
          )}
        </div>
      </footer>
    </>
  )
}
