import { PlusIcon, SearchIcon } from "@primer/octicons-react"
import { Button, Select, TextInput } from "@primer/react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../api/client"
import { Empty, ErrorNotice, Loading, PageHeader, Pager, StateTag } from "../components/common"
import { date } from "../lib/format"

const states = [
  ["", "全部状态"],
  ["draft", "待提交"],
  ["queued", "排队中"],
  ["starting", "启动中"],
  ["running", "运行中"],
  ["succeeded", "已完成"],
  ["failed", "失败"],
  ["stopped", "已停止"],
  ["needs_reconciliation", "需检查"],
]

export default function ExperimentsPage() {
  const [search, setSearch] = useState("")
  const [state, setState] = useState("")
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ["experiments", search, state, page],
    queryFn: ({ signal }) =>
      api.experiments({ q: search || undefined, state: state || undefined, page, page_size: 30 }, signal),
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
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
      <ErrorNotice error={query.error} />
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} size={30} total={query.data.total} onChange={setPage} />
        </>
      )}
    </>
  )
}
