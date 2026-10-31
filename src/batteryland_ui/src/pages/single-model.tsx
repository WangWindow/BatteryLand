import { useState } from "react"
import { accuracy, demoExperiments, relativeError, validInterval } from "../features/single-model/data"
import { IntervalChart } from "../features/single-model/interval-chart"
import "../features/single-model/single-model.css"

export default function SingleModelPage() {
  const [experimentId, setExperimentId] = useState("demo-a")
  const [stage, setStage] = useState<"test" | "validation">("test")
  const experiment = demoExperiments.find((item) => item.id === experimentId) ?? demoExperiments[0]
  const rows = experiment.stages[stage]
  const score = accuracy(rows)
  return (
    <div className="sp-page">
      <header className="page-header">
        <div>
          <h1>单模型预测</h1>
        </div>
        <span className="sp-demo">演示数据</span>
      </header>
      <section className="sp-panel sp-filters" aria-label="选择预测结果">
        <label>
          实验
          <select value={experimentId} onChange={(event) => setExperimentId(event.target.value)}>
            {demoExperiments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          阶段
          <select value={stage} onChange={(event) => setStage(event.target.value as "test" | "validation")}>
            <option value="test">测试集</option>
            <option value="validation">验证集</option>
          </select>
        </label>
        <p>模型：{experiment.model} · 预测目标：EOL · 90%预测区间</p>
      </section>
      <p className="sp-note">当前为前端演示，数据及区间均为模拟值，尚未接入真实预测结果。</p>
      {rows.length === 0 ? (
        <section className="sp-panel sp-empty" role="status">
          <h2>暂无验证集预测结果</h2>
          <p>请选择测试集或切换其他实验。</p>
        </section>
      ) : (
        <>
          <section className="sp-panel" aria-labelledby="sp-chart-title">
            <div className="sp-heading">
              <h2 id="sp-chart-title">寿命预测与不确定性</h2>
              <div className="sp-score">
                <strong>
                  15%-ACC：
                  {score.value === null
                    ? "无法计算"
                    : `${(score.value * 100).toFixed(1)}%（${score.passed}/${score.total}）`}
                </strong>
                <small>相对误差 ≤15% 的电池占比 · 仅统计有效真实值</small>
              </div>
            </div>
            <IntervalChart key={`${experimentId}-${stage}`} rows={rows} />
            {rows.some((row) => !validInterval(row)) && (
              <p className="sp-note">部分电池未提供有效预测区间，图中仅展示可用数值。</p>
            )}
          </section>
          <section className="sp-panel" aria-labelledby="sp-table-title">
            <h2 id="sp-table-title">预测明细</h2>
            <div className="sp-table-scroll">
              <table>
                <caption>寿命与区间单位：循环次数</caption>
                <thead>
                  <tr>
                    <th scope="col">电池编号</th>
                    <th scope="col">真实值</th>
                    <th scope="col">预测值</th>
                    <th scope="col">90%预测区间</th>
                    <th scope="col">相对误差</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const error = relativeError(row)
                    const failed = error !== null && error > 0.15 + 1e-12
                    return (
                      <tr key={row.id}>
                        <th scope="row">{row.id}</th>
                        <td>{row.target ?? "暂无"}</td>
                        <td>{row.prediction}</td>
                        <td>{validInterval(row) ? `${row.lower}～${row.upper}` : "未提供"}</td>
                        <td className={failed ? "sp-failed" : undefined}>
                          {error === null ? "—" : `${(error * 100).toFixed(2)}%`}
                          {failed && <small> 超过15%</small>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="sp-note">
              90%预测区间展示预测不确定性；15%-ACC衡量预测误差达标比例，两者独立。缺少真实值的电池不参与准确率统计。
            </p>
          </section>
        </>
      )}
    </div>
  )
}
