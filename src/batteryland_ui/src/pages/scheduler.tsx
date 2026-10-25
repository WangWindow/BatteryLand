import { SyncIcon } from "@primer/octicons-react"
import { Button } from "@primer/react"
import { useQuery } from "@tanstack/react-query"
import { api } from "../api/client"
import { Empty, ErrorNotice, Loading, PageHeader, StateTag } from "../components/common"
import { bytes, date } from "../lib/format"

export default function SchedulerPage() {
  const status = useQuery({
    queryKey: ["scheduler-status"],
    queryFn: ({ signal }) => api.scheduler(signal),
    refetchInterval: 5000,
  })
  const nodes = useQuery({
    queryKey: ["resources"],
    queryFn: ({ signal }) => api.resources(signal),
    refetchInterval: 5000,
  })
  const queue = useQuery({
    queryKey: ["scheduler-queue"],
    queryFn: ({ signal }) => api.queue(signal),
    refetchInterval: 2000,
  })
  return (
    <>
      <PageHeader
        title="任务与资源"
        description="查看本机调度状态、待运行任务，以及最近一次采样的 CPU、内存和 GPU 信息。"
        actions={
          <Button
            leadingVisual={SyncIcon}
            onClick={() => {
              void status.refetch()
              void nodes.refetch()
              void queue.refetch()
            }}
          >
            立即刷新
          </Button>
        }
      />
      <ErrorNotice error={status.error ?? nodes.error ?? queue.error} />
      {status.isPending || nodes.isPending || queue.isPending ? (
        <Loading />
      ) : (
        <>
          <div className="stat-strip scheduler-summary">
            <div>
              <span>调度器</span>
              <strong>{status.data?.enabled ? "运行中" : "未启动"}</strong>
            </div>
            <div>
              <span>活跃任务</span>
              <strong>{queue.data?.active.length ?? 0}</strong>
            </div>
            <div>
              <span>等待任务</span>
              <strong>{queue.data?.waiting.length ?? 0}</strong>
            </div>
            <div>
              <span>派发状态</span>
              <strong>{queue.data?.dispatch_paused ? "已暂停" : "正常"}</strong>
            </div>
          </div>
          {status.data?.reason && <div className="notice">{status.data.reason}</div>}
          {queue.data?.reason && <div className="notice">{queue.data.reason}</div>}
          <section className="dashboard-section">
            <div className="section-title">
              <h2>计算节点</h2>
              <span className="subtle">{nodes.data?.length ?? 0} 个节点 · 自动更新</span>
            </div>
            {nodes.data?.length ? (
              <div className="node-list">
                {nodes.data.map((node) => {
                  const resources = node.resources
                  const memoryUsed =
                    resources.memory_total != null && resources.memory_available != null
                      ? resources.memory_total - resources.memory_available
                      : null
                  return (
                    <article className="node-panel" key={node.id}>
                      <div className="section-title">
                        <div>
                          <h3>节点 {node.id.slice(0, 8)}</h3>
                          <span className="subtle">采样时间 {date(node.last_seen_at)}</span>
                        </div>
                        <span className="state state-succeeded">在线</span>
                      </div>
                      <div className="resource-grid">
                        <div>
                          <span>CPU 使用率</span>
                          <strong>
                            {resources.cpu_percent == null ? "—" : `${resources.cpu_percent.toFixed(1)}%`}
                          </strong>
                          <Meter value={resources.cpu_percent ?? 0} />
                        </div>
                        <div>
                          <span>内存</span>
                          <strong>
                            {memoryUsed == null
                              ? "—"
                              : `${bytes(memoryUsed)} / ${bytes(resources.memory_total)}`}
                          </strong>
                          <Meter
                            value={
                              resources.memory_total ? ((memoryUsed ?? 0) / resources.memory_total) * 100 : 0
                            }
                          />
                        </div>
                      </div>
                      {resources.gpus?.length ? (
                        <div className="gpu-list">
                          {resources.gpus.map((gpu) => (
                            <div className="gpu-row" key={gpu.uuid}>
                              <div>
                                <strong>GPU {gpu.cuda_index}</strong>
                                <span className="subtle">{gpu.uuid}</span>
                              </div>
                              <span>
                                利用率 {gpu.utilization_percent == null ? "—" : `${gpu.utilization_percent}%`}
                              </span>
                              <span>
                                显存{" "}
                                {bytes(
                                  gpu.total_bytes != null && gpu.free_bytes != null
                                    ? gpu.total_bytes - gpu.free_bytes
                                    : null,
                                )}{" "}
                                / {bytes(gpu.total_bytes)}
                              </span>
                              <Meter value={gpu.utilization_percent ?? 0} />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="subtle">{resources.reason ?? "未发现可用 GPU"}</p>
                      )}
                    </article>
                  )
                })}
              </div>
            ) : (
              <Empty title="还没有节点资源记录" />
            )}
          </section>
          <section className="dashboard-section">
            <div className="section-title">
              <h2>正在运行</h2>
              <span className="subtle">{queue.data?.active.length ?? 0}</span>
            </div>
            {queue.data?.active.length ? (
              <QueueTable rows={queue.data.active} />
            ) : (
              <p className="subtle">当前没有运行中的训练任务。</p>
            )}
          </section>
          <section className="dashboard-section">
            <div className="section-title">
              <h2>等待调度</h2>
              <span className="subtle">{queue.data?.waiting.length ?? 0}</span>
            </div>
            {queue.data?.waiting.length ? (
              <QueueTable rows={queue.data.waiting} />
            ) : (
              <p className="subtle">队列为空。</p>
            )}
          </section>
        </>
      )}
    </>
  )
}
function Meter({ value }: { value: number }) {
  return (
    <div className="meter" aria-hidden="true">
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}
function QueueTable({ rows }: { rows: import("../api/types").ExperimentSummary[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>实验</th>
            <th>状态</th>
            <th>设备</th>
            <th>创建时间</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.id}>
              <td>
                <a href={`/experiments/${item.id}`}>{item.name}</a>
              </td>
              <td>
                <StateTag state={item.state} />
              </td>
              <td>{item.actual_device ?? item.effective_device ?? item.requested_device ?? "自动"}</td>
              <td>{date(item.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
