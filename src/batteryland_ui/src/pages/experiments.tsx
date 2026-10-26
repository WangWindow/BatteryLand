import { KebabHorizontalIcon, PlusIcon, SearchIcon, StopIcon, TrashIcon } from "@primer/octicons-react"
import { ActionList, ActionMenu, Button, Select, TextInput } from "@primer/react"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { api } from "../api/client"
import { Empty, ErrorNotice, Loading, Modal, PageHeader, Pager, StateTag } from "../components/common"
import { date } from "../lib/format"

const states = [
  ["", "全部状态"],
  ["draft", "待提交"],
  ["queued", "排队中"],
  ["starting", "启动中"],
  ["running", "运行中"],
  ["succeeded", "已完成"],
  ["failed", "失败"],
  ["cancelled", "已取消"],
  ["stopped", "已停止"],
  ["needs_reconciliation", "需检查"],
]
const deletableStates = new Set(["draft", "succeeded", "failed", "cancelled", "stopped"])
const stoppableStates = new Set(["queued", "starting", "running"])

export default function ExperimentsPage() {
  const client = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const [state, setState] = useState("")
  const [page, setPage] = useState(1)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const query = useQuery({
    queryKey: ["experiments", search, state, page],
    queryFn: ({ signal }) =>
      api.experiments({ q: search || undefined, state: state || undefined, page, page_size: 30 }, signal),
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
  })
  const stop = useMutation({
    mutationFn: (id: string) => api.stop(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["experiments"] })
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteExperiment(id),
    onSuccess: (_, id) => {
      for (const key of ["experiment", "result", "artifacts", "logs"]) {
        client.removeQueries({ queryKey: [key, id] })
      }
      if (query.data?.items.length === 1 && page > 1) setPage((current) => current - 1)
      void client.invalidateQueries({ queryKey: ["experiments"] })
      setDeleteTarget(null)
    },
  })
  return (
    <>
      <PageHeader
        title="实验"
        description="管理已保存配置和训练任务。每次提交都会创建一次新的训练运行。"
        actions={
          <Button as={Link} to="/experiments/new" leadingVisual={PlusIcon} variant="primary">
            新建实验
          </Button>
        }
      />
      <div className="toolbar">
        <TextInput
          aria-label="搜索实验"
          placeholder="搜索实验名称或 ID…"
          leadingVisual={SearchIcon}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
        />
        <Select
          aria-label="实验状态"
          value={state}
          onChange={(event) => {
            setState(event.target.value)
            setPage(1)
          }}
        >
          {states.map(([value, label]) => (
            <Select.Option key={value} value={value}>
              {label}
            </Select.Option>
          ))}
        </Select>
        <span className="subtle">{query.data?.total.toLocaleString() ?? "—"} 项</span>
      </div>
      <ErrorNotice error={query.error ?? stop.error} />
      {query.isPending ? (
        <Loading />
      ) : !query.data?.items.length ? (
        <Empty title="没有匹配的实验">
          <p>创建实验时可选择数据划分，导入或可视化编辑配置，再由后端校验。</p>
          <Button as={Link} to="/experiments/new" variant="primary">
            新建实验
          </Button>
        </Empty>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>实验</th>
                  <th>状态</th>
                  <th>请求设备</th>
                  <th>实际设备</th>
                  <th>创建时间</th>
                  <th className="experiment-actions-heading">操作</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((experiment) => (
                  <tr key={experiment.id}>
                    <td>
                      <Link to={`/experiments/${experiment.id}`} className="experiment-link">
                        <strong>{experiment.name}</strong>
                        <span className="subtle">{experiment.id}</span>
                      </Link>
                    </td>
                    <td>
                      <StateTag state={experiment.state} />
                    </td>
                    <td>{experiment.requested_device ?? "—"}</td>
                    <td>{experiment.actual_device ?? experiment.effective_device ?? "等待调度"}</td>
                    <td>{date(experiment.created_at)}</td>
                    <td className="experiment-actions-cell">
                      <ActionMenu>
                        <ActionMenu.Button
                          aria-label={`实验操作：${experiment.name}`}
                          leadingVisual={KebabHorizontalIcon}
                          trailingAction={null}
                          className="experiment-menu-button"
                        />
                        <ActionMenu.Overlay side="outside-bottom" align="end">
                          <ActionList>
                            <ActionList.Item onSelect={() => navigate(`/experiments/${experiment.id}`)}>
                              查看实验
                            </ActionList.Item>
                            {experiment.state === "draft" && (
                              <ActionList.Item
                                onSelect={() => navigate(`/experiments/new?edit=${experiment.id}`)}
                              >
                                编辑配置
                              </ActionList.Item>
                            )}
                            {stoppableStates.has(experiment.state) && (
                              <ActionList.Item
                                loading={stop.isPending && stop.variables === experiment.id}
                                onSelect={() => stop.mutate(experiment.id)}
                              >
                                <ActionList.LeadingVisual>
                                  <StopIcon />
                                </ActionList.LeadingVisual>
                                终止实验
                              </ActionList.Item>
                            )}
                            <ActionList.Divider />
                            <ActionList.Item
                              variant="danger"
                              disabled={!deletableStates.has(experiment.state)}
                              inactiveText={
                                experiment.state === "needs_reconciliation"
                                  ? "请先核实原训练进程的状态。"
                                  : deletableStates.has(experiment.state)
                                    ? undefined
                                    : "请先终止实验并等待任务结束后再删除。"
                              }
                              onSelect={() => {
                                remove.reset()
                                setDeleteTarget({ id: experiment.id, name: experiment.name })
                              }}
                            >
                              <ActionList.LeadingVisual>
                                <TrashIcon />
                              </ActionList.LeadingVisual>
                              删除实验
                            </ActionList.Item>
                          </ActionList>
                        </ActionMenu.Overlay>
                      </ActionMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} size={30} total={query.data.total} onChange={setPage} />
        </>
      )}
      {deleteTarget && (
        <Modal
          title="删除实验"
          onClose={() => {
            if (!remove.isPending) setDeleteTarget(null)
          }}
          footer={
            <div className="actions">
              <Button disabled={remove.isPending} onClick={() => setDeleteTarget(null)}>
                取消
              </Button>
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={() => remove.mutate(deleteTarget.id)}
              >
                删除实验
              </Button>
            </div>
          }
        >
          <p>确定删除“{deleteTarget.name}”吗？实验记录和结果索引会移除，磁盘产物会保留。此操作无法撤销。</p>
          <ErrorNotice error={remove.error} />
        </Modal>
      )}
    </>
  )
}
