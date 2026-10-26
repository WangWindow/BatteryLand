import { PlusIcon, TrashIcon } from "@primer/octicons-react"
import { Button, Checkbox, FormControl, Select, TextInput } from "@primer/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { api } from "../api/client"
import type { Schema } from "../api/types"
import { ChartView } from "../components/chart-view"
import { CodeEditor } from "../components/code-editor"
import { Empty, ErrorNotice, Loading, PageHeader } from "../components/common"
import { partitions } from "../lib/format"

type Part = "train" | "val" | "test"
type SetChoice = {
  key: string
  kind: "source" | "split" | "group" | "logical"
  ref: string
  label: string
  version?: number
  parts: Part[]
}
const labels = { train: "训练集", val: "验证集", test: "测试集" }
const categories: Schema["Category"][] = ["source", "chemistry", "material", "temperature_c"]

export default function DatasetAnalysisPage() {
  const sources = useQuery({ queryKey: ["sources"], queryFn: ({ signal }) => api.sources(signal) })
  const splits = useQuery({
    queryKey: ["splits", "analysis"],
    queryFn: ({ signal }) => api.splits({ page_size: 100 }, signal),
  })
  const groups = useQuery({ queryKey: ["groups"], queryFn: ({ signal }) => api.groups(signal) })
  const logicalDatasets = useQuery({
    queryKey: ["logical-datasets"],
    queryFn: ({ signal }) => api.logicalDatasets(1, signal),
  })
  const [kind, setKind] = useState<SetChoice["kind"]>("source")
  const [reference, setReference] = useState("")
  const [label, setLabel] = useState("")
  const [choices, setChoices] = useState<SetChoice[]>([])
  const [analysis, setAnalysis] = useState("counts")
  const [category, setCategory] = useState<Schema["Category"]>("chemistry")
  const candidates = useMemo(() => {
    if (kind === "source")
      return (
        sources.data?.items.map((item) => ({
          value: item.id,
          label: `${item.name} · ${item.battery_count.toLocaleString()} 个电池`,
        })) ?? []
      )
    if (kind === "logical")
      return (
        logicalDatasets.data?.items.map((item) => ({
          value: item.id,
          label: `${item.name} · ${item.member_count.toLocaleString()} 个电池${item.stale ? " · 来源已更新" : ""}`,
        })) ?? []
      )
    if (kind === "split")
      return (
        splits.data?.items.map((item) => ({ value: item.id, label: `${item.name} · v${item.version}` })) ?? []
      )
    return (
      groups.data?.items.map((item) => ({
        value: item.name,
        label: `${item.name} · ${item.counts.matched.toLocaleString()} 个匹配电池`,
      })) ?? []
    )
  }, [kind, sources.data, splits.data, groups.data, logicalDatasets.data])
  const request = useMemo<Schema["DifferenceRequest"]>(
    () => ({
      analysis_kind: analysis,
      ...(analysis === "category_distribution" ? { category } : {}),
      sets: choices.map((choice) => ({
        label: choice.label,
        partitions: choice.parts,
        ...(choice.kind === "source"
          ? { source_id: choice.ref }
          : choice.kind === "group"
            ? { named_group: choice.ref }
            : choice.kind === "logical"
              ? { logical_dataset_id: choice.ref }
              : { split: { id: choice.ref, version: choice.version ?? 1 } }),
      })),
    }),
    [analysis, category, choices],
  )
  const compare = useMutation({
    mutationFn: async () => {
      const [difference, charts] = await Promise.all([
        api.differences(request),
        api.charts({
          chart_type:
            analysis === "counts" ? "set_count_bar" : analysis === "overlap" ? "overlap_bar" : "category_bar",
          sets: request.sets,
          ...(analysis === "category_distribution" ? { category } : {}),
        }),
      ])
      return { difference, charts }
    },
  })

  function addChoice() {
    const candidate = candidates.find((item) => item.value === reference)
    if (!candidate || choices.some((item) => item.key === `${kind}:${reference}`)) return
    const split = kind === "split" ? splits.data?.items.find((item) => item.id === reference) : undefined
    const display = label.trim() || candidate.label.split(" · ")[0]
    setChoices((old) => [
      ...old,
      {
        key: `${kind}:${reference}`,
        kind,
        ref: reference,
        label: display,
        ...(split ? { version: split.version } : {}),
        parts: [...partitions],
      },
    ])
    setReference("")
    setLabel("")
  }
  function updateChoice(key: string, part: Part, checked: boolean) {
    setChoices((old) =>
      old.map((item) =>
        item.key !== key
          ? item
          : {
              ...item,
              parts: checked
                ? [...new Set([...item.parts, part])]
                : item.parts.filter((value) => value !== part),
            },
      ),
    )
  }

  const loading = sources.isPending || splits.isPending || groups.isPending || logicalDatasets.isPending
  return (
    <>
      <PageHeader
        title="数据集比较"
        description="比较已登记数据来源和已保存数据划分，可查看整体或训练、验证、测试分组的统计差异。"
      />
      <ErrorNotice
        error={sources.error ?? splits.error ?? groups.error ?? logicalDatasets.error ?? compare.error}
      />
      {loading ? (
        <Loading />
      ) : (
        <div className="analysis-layout">
          <section className="analysis-config">
            <div className="section-title">
              <h2>比较对象</h2>
              <span className="subtle">添加需要比较的数据</span>
            </div>
            <fieldset className="choice-kind">
              <legend className="sr-only">数据对象类型</legend>
              {[
                ["source", "数据来源"],
                ["logical", "逻辑数据集"],
                ["split", "数据划分"],
                ["group", "命名集合"],
              ].map(([value, name]) => (
                <Button
                  key={value}
                  aria-pressed={kind === value}
                  size="small"
                  onClick={() => {
                    setKind(value as SetChoice["kind"])
                    setReference("")
                  }}
                >
                  {name}
                </Button>
              ))}
            </fieldset>
            <FormControl>
              <FormControl.Label>选择对象</FormControl.Label>
              <Select
                aria-label="选择数据对象"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              >
                <Select.Option value="">选择数据对象</Select.Option>
                {candidates.map((item) => (
                  <Select.Option key={item.value} value={item.value}>
                    {item.label}
                  </Select.Option>
                ))}
              </Select>
            </FormControl>
            <FormControl>
              <FormControl.Label>图例名称</FormControl.Label>
              <TextInput
                block
                placeholder="默认使用对象名称"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </FormControl>
            <Button leadingVisual={PlusIcon} disabled={!reference} onClick={addChoice}>
              添加比较对象
            </Button>
            <div className="analysis-choice-list">
              {choices.length ? (
                choices.map((item) => (
                  <article className="analysis-choice" key={item.key}>
                    <div className="section-title">
                      <strong>{item.label}</strong>
                      <Button
                        aria-label={`移除 ${item.label}`}
                        size="small"
                        variant="invisible"
                        leadingVisual={TrashIcon}
                        onClick={() => setChoices((old) => old.filter((value) => value.key !== item.key))}
                      />
                    </div>
                    <span className="subtle">
                      {item.kind === "source"
                        ? "完整数据来源"
                        : item.kind === "logical"
                          ? "完整逻辑数据集"
                          : item.kind === "group"
                            ? "命名集合"
                            : `数据划分 v${item.version}`}
                    </span>
                    {item.kind === "source" || item.kind === "logical" ? (
                      <span className="subtle">以完整集合参与统计。</span>
                    ) : (
                      <div className="part-checkboxes">
                        {partitions.map((part) => (
                          <div className="part-checkbox" key={part}>
                            <Checkbox
                              aria-label={`${labels[part]}集合`}
                              checked={item.parts.includes(part)}
                              onChange={(event) => updateChoice(item.key, part, event.target.checked)}
                            />
                            <span>{labels[part]}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                ))
              ) : (
                <p className="subtle">尚未添加比较对象。</p>
              )}
            </div>
            <FormControl>
              <FormControl.Label>统计维度</FormControl.Label>
              <Select value={analysis} onChange={(event) => setAnalysis(event.target.value)}>
                <Select.Option value="counts">数据量</Select.Option>
                <Select.Option value="overlap">集合重叠</Select.Option>
                <Select.Option value="category_distribution">属性分布</Select.Option>
              </Select>
            </FormControl>
            {analysis === "category_distribution" && (
              <FormControl>
                <FormControl.Label>属性</FormControl.Label>
                <Select
                  value={category}
                  onChange={(event) => setCategory(event.target.value as Schema["Category"])}
                >
                  {categories.map((item) => (
                    <Select.Option key={item} value={item}>
                      {item === "source"
                        ? "数据来源"
                        : item === "chemistry"
                          ? "化学体系"
                          : item === "material"
                            ? "材料"
                            : "温度"}
                    </Select.Option>
                  ))}
                </Select>
              </FormControl>
            )}
            <Button
              variant="primary"
              disabled={choices.length < 1 || choices.some((item) => !item.parts.length)}
              loading={compare.isPending}
              onClick={() => compare.mutate()}
            >
              计算差异
            </Button>
          </section>
          <section className="analysis-results">
            <div className="section-title">
              <h2>统计结果</h2>
              {compare.data && <span className="subtle">统计由后端差异接口生成</span>}
            </div>
            {!compare.data ? (
              <Empty title="选择数据后开始比较">
                <p>结果使用已保存的统计特征计算。</p>
              </Empty>
            ) : (
              <>
                <ErrorNotice error={null} />
                {compare.data.difference.warnings.length > 0 && (
                  <ul className="warning-list">
                    {compare.data.difference.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
                {compare.data.charts.charts.map((chart) => (
                  <ChartView key={chart.id} chart={chart} />
                ))}
                <details className="result-data">
                  <summary>统计明细</summary>
                  <CodeEditor
                    ariaLabel="统计差异 JSON 只读预览"
                    height="360px"
                    language="json"
                    readOnly
                    value={JSON.stringify(compare.data.difference.statistics)}
                  />
                </details>
              </>
            )}
          </section>
        </div>
      )}
    </>
  )
}
