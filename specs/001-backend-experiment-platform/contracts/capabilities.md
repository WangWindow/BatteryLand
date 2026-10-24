# Capability Contracts: 训练、调度、分析与图表

**Version**: 1
**Date**: 2026-10-23
**Provider**: deeplatform `6b4c76d6e639ddaf9db9c15bf04771179a68d988`

## 共同规则

接口由 application/ports 声明，基础设施实现；外部实现仅接收值对象、不可变数据和受控资源引用，
不接收 ORM Session、数据库连接或主项目内部实体。每类能力报告 provider_id、version、
supported_operations、availability、limitations。真实基础实现与测试替身分别注册，运行模式不加载替身。

错误统一为稳定 symbol、message、可选字段位置和详情；API 层再映射 HTTP 与数值 code。
能力不足、资源不存在、配置无效、执行身份不确定分别表达，不能用空列表或模拟结果替代错误。

## TrainingGateway

| 操作 | 输入 | 输出和副作用 |
| --- | --- | --- |
| catalog | 可选 scope/type | 复用 get_catalog/get_component_schema；描述 schema_version=1，不创建实例 |
| inspect/upload | 受控临时组件引用、scope、文件名 | 复用静态注册检查和 upload_component；返回 source_hash/注册声明/资源引用 |
| validate | native_config、资源绑定、明确设备 | 结构和引用检查、自动注册及 Frame.check；不 prepare、不构建组件、不启动训练 |
| prepare | MaterializedExecutionInput | 调用 Frame.prepare，返回 PreparedExecution；仅建立本次目录及配置快照 |
| spawn | PreparedExecution | 后端直接启动 provider main.py --experiment-dir；返回 ExecutionReceipt |
| observe | ExecutionReceipt | 进程、provider 状态与产物观察，不直接写平台业务状态 |
| signal | ExecutionReceipt、信号阶段 | 只控制归属明确的进程组，返回发送与退出观察，供调度器使用 |

**FrozenExperimentInput**：experiment_id、intent_id、配置文档版本、划分版本、组件 source_hash、
provider_commit、requested_device；仅包含持久化逻辑绑定，供排队及派发决策使用。

**MaterializedExecutionInput**：FrozenExperimentInput 加上派发后生成的 YAML、划分、运行清单引用及校验值。

**PreparedExecution**：experiment_id、intent_id、provider_commit、directory_ref、
provider_config_sha256、input_manifest_sha256。目录必须由 Frame.prepare 创建且属于允许运行根。

**ExecutionReceipt**：以上身份、pid、pgid、Linux boot_id、/proc 启动时钟值、started_at、
requested_device、effective_device（未证实为 null）。内部进程和绝对路径信息不作为公共 DTO 返回。

**ExecutionObservation**：identity_matches、alive、exit_code、provider_status、
observed_at、可空 effective_device。产物由独立采集器登记；无法证明归属或终态时由宿主转入待核实。
配置中的设备字符串不能被当作实际设备证据。

### 桥接和环境

- 桥接脚本由主项目维护，只包装既有入口，通过显式 BATTERYLAND_TRAINING_PYTHON 调用；API 进程不 import provider 或 torch。
- 控制桥接命令为 catalog、validate、upload、prepare。一次命令从 stdin 接受 schema_version=1 的 JSON，
  stdout 恰好输出一个成功或错误 JSON 对象，普通导入输出和诊断进入 stderr；非零退出表示命令失败。
- 控制命令默认 30s 超时；超时不自动重试有副作用的 upload/prepare。prepare 后回执缺失进入待核实。
- 实际训练不通过双重后台入口启动：后端 Popen 训练解释器及 main.py --experiment-dir，
  stdin=DEVNULL、stdout/stderr 写 console.log、start_new_session=True，直接持有子进程身份。
- provider 根为只读代码。运行根有 components/、task/，与 provider 根组成命名空间搜索路径；
  上传到运行根。单写入锁内静态合并两处注册声明查重，再调用原上传工具，不复制其源码逻辑。
- 组件源码发布后保存 sha256；入队后若组件哈希或 provider 提交改变，派发前失败，不能运行漂移的输入。

### 输入导出与能力门槛

- 将已冻结配置生成 YAML，保留 mate/task 与 @name 引用。技术性路径只绑定到允许的运行根，
  生成清单记录绑定和校验值，不反向修改业务快照。
- datafactory 的 root_path 绑定到本实验的受管数据工作区；复制 provider 的 Life labels 与
  seen_unseen_labels 输入清单，允许其生成合并标签和 data 软链接，不将可写目录软链回子模块。
  此准备不改变固定原始数据来源；/data/BatteryLife_Processed 仍须真实可读。
- 划分生成严格的 dataset/train/val/test 文件，成员从平台 Battery ID 映射为 provider 文件名。
  同一来源的歧义映射失败，不能跨来源按文件名合并。
- 使用 BatteryLifeDatasetFactory 的当前真实执行仅接受与内置划分成员和顺序完全一致的快照，并核对实际默认来源可读；
  生成自定义划分文件本身不代表 factory 能读取它。不同内容返回 integration_precondition_failed。
- 约束按任务及组件生效；MyTask 不使用电池工厂时不要求 split 或原始电池目录，允许独立 CPU 冒烟。
  原始目录按 provider 的实际扫描范围核对，存在同名候选文件时拒绝歧义，不接受 mtime 静默选出的另一个资源。
- CPU 与明确 cuda:N 可作为请求值，auto 被拒绝。设备可用性由训练环境校验，
  CUDA 精确编号和 effective_device 需真实联调；不以 CUDA_VISIBLE_DEVICES 重新编号掩盖差异。
- BatteryLifeRun 之外的独立评估和迁移需对应任务交付；查询目录中的能力与配置可保存，
  执行校验必须准确说明未就绪。原始数据目录、split_dir 接口问题反馈维护者。

## SchedulerPort

宿主应用持久保存队列与业务状态；调度能力消费队列快照并返回决策或执行观察，
所有持久化状态转换由应用服务完成。未来模块不能直接写平台数据库。

| 操作 | 输入 | 输出 |
| --- | --- | --- |
| choose | 按 queue_order 排序的 FrozenExperimentInput、当前活动观察 | DispatchDecision 列表 |
| request_stop | ExecutionReceipt、停止阶段和截止时间 | StopObservation：已请求/仍存活/已退出/身份不确定 |
| capabilities | 无 | 策略、并行度、设备选择与停止能力 |

**DispatchDecision**：experiment_id、intent_id、requested_device、resolved_device、policy_version。
首版 resolved_device 必须等于 requested_device；非明确设备或发生改写时拒绝派发。
后端输入导出器生成最终配置；未来支持 auto 的模块也必须先返回确定设备再导出，显式设备始终不得改写。

默认 `local-serial/v1`：

- 活动状态 starting/running/stopping/needs_reconciliation 存在时不派发；否则只选择第一项。
- 应用用条件更新认领 queued → starting；认领失败重新读取，不在同一事务里启动进程。
- 一个运行根只允许一个协调实例；队列不使用内存作为唯一来源，不增加 Redis。
- 排队停止由应用原子改为 cancelled；正在启动的停止请求保存 stop_requested_at，
  准备未产生进程则先进入 stopping 再结束为 stopped，已产生进程则按 receipt 处理，不丢失竞态请求。
- 运行项 SIGINT 后等 10s，再 SIGTERM 等 5s，最后 SIGKILL；协调循环不阻塞 API。
  只有整个所属进程组退出才报告 stopped；无法确认归属则待核实，不向任意 PID 发信号。
- 自然完成先于停止生效时保持 succeeded；provider interrupted 且无平台停止请求时按失败诊断，不能伪装人为停止。

### 恢复与防重复

平台 intent_id、状态 revision 和目录回执共同限定一次启动。provider 的 status.json 存在检查不是互斥锁。
prepare 回执先保存，再 spawn；进程启动与回执提交之间仍可能崩溃。
启动身份或回执不确定时进入 needs_reconciliation，不自动调用 prepare/spawn。
核对清单、boot_id、进程启动时钟、进程组和 provider 产物；仅 PID 相同不构成归属证明。

## DifferenceAnalyzer

`compare(sets, analysis_kind, category?) → DifferenceResult`

- sets：每个集合的稳定 ID/名称、指定划分版本与分组、Battery ID 集合及已登记元数据。
- analysis_kind：counts、overlap、category_distribution。category 仅支持已登记的固定分类字段。
- DifferenceResult：schema_version=1、provider_id、输入身份、集合计数、交集/差集或类别计数、缺失元数据数量及 warnings。
- 默认 `basic-difference/v1` 只做确定性的集合统计；不同来源同名电池不合并；
  空集合可比较，缺失分类单列 unknown。退化机理、域距离等专业分析返回 unsupported_capability。
- 不读取原始 pickle，不依赖训练环境，不为统计连接数据库；应用服务先查询并构造输入。

## ResultComparison

`compare(results, selected_metrics?, battery_ids?) → ComparisonData`

每个结果必须带 experiment_id、结果版本和来源。输出 metric_rows 与 prediction_rows，
保留实验、stage、metric_name、value、unit、granularity、battery_id、prediction、target 等身份。
对齐使用并集，缺失字段为 null 并说明原因，禁止补零；不把窗口指标替换为电池级误差。
相同 metric_name 不代表单位/粒度相容；未声明单位的自定义指标标 unknown，不跨实验默认合并。

## ChartBuilder 与 ChartSpec

`build(chart_request, ComparisonData | DifferenceResult) → ChartBundle`

默认 `basic-charts/v1` 支持 metric_bar、epoch_line、prediction_scatter、set_count_bar、
category_bar、overlap_bar；不支持的类型返回 unsupported_capability。
metric_bar/epoch_line 必须明确 metric 与 stage；散点图只使用真实存在的 target/prediction 配对，
没有可用配对时返回 no_ground_truth，不能画虚构真值；类别和序列身份必须稳定。

```json
{
  "schema_version": 1,
  "provider_id": "basic-charts/v1",
  "charts": [{
    "id": "metric:test:mape:ratio:window",
    "kind": "bar",
    "title": "MAPE comparison",
    "x_axis": {"label": "Experiment", "unit": null, "value_type": "category"},
    "y_axis": {"label": "MAPE", "unit": "ratio", "value_type": "number"},
    "series": [{"id": "mape", "label": "MAPE", "points": [{"x": "experiment-a", "y": 0.1}]}],
    "warnings": []
  }],
  "warnings": []
}
```

ChartSpec.kind 为 bar/line/scatter，axes 声明坐标和单位，series.points 的 x 为数值或类别、y 为有限数或 null；
点可附 experiment_id、battery_id。类型标识与业务身份供前端统一渲染，不传 HTML、JS、React 源码或图片代替交互数据。
不相容单位/粒度拆为独立 charts 并附说明；已知单位不做隐式乘除换算，unknown 单位按实验隔离。

## ArtifactReader / ResultImporter

- status.json 映射 running/completed/failed/interrupted，但它不是心跳，必须结合真实进程观察。
- train.log/console.log 提供不可越界的游标式读取；文件变更返回 cursor_invalid，不能静默跳过丢失内容。
- metrics.jsonl 每条为 epoch/train/validation/test；只提交完整行，记录和游标同事务写入。
- best_result.json 按内容哈希导入；test_predictions_aggregation=mean_by_battery 单独保留。
- 最终结果原文归档后再提交结果版本及最终指标投影；一次导入失败不覆盖旧头，也不改变已确认的执行终态。
- JSON 结果限 16 MiB，单条 JSONL 限 4 MiB；只读取受管实验目录的普通文件，跳过越界符号链接。
- 当前 MAPE 是 ratio，Accuracy 为 percent；其余单位从明确组件声明获得，否则 unknown。
- 自定义任务可以不产出 metrics/best_result；返回 available=false 及原因，不伪造训练指标。
- 文件截断/替换建立新导入代次，幂等刷新该来源投影；生产导入不运行任意来源代码。

## 固定版本契约测试

覆盖 provider 结构校验无构造副作用、目录元数据、内置/上传跨根查重、导出字段、
准备目录唯一关联、请求与实际设备区分、状态映射、指标单位及聚合语义。
自定义划分和未交付任务的拒绝行为也属于有效契约测试；不宣称对应真实训练已接入。
