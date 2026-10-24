# HTTP API Contract: 首版业务接口

**Version**: `/api/v1` / 1.0.0
**Machine-readable contract**: [openapi.json](openapi.json)
**Data semantics**: [data-model.md](../data-model.md)
**Capability semantics**: [capabilities.md](capabilities.md)

## 协议、错误与分页

同步 JSON 成功响应：`{"code":0,"message":"ok","data":...}`。
错误响应：`{"code":1001,"message":"...","data":{"error":"invalid_input","fields":[]}}`。
fields 条目为 path/message，内部堆栈不进入响应；OpenAPI 中每条路由都声明对应成功 data 类型。
文件下载与 SSE 不套 JSON envelope。成功创建返回 201，入队和停止受理返回 202，普通查询与幂等确认返回 200。

| symbol | code | HTTP | 含义 |
| --- | --- | --- | --- |
| invalid_input | 1001 | 422 | 参数、比例、划分、字段位置或配置不合法 |
| not_found | 1002 | 404 | 资源或指定版本不存在 |
| conflict | 1003 | 409 | 修订冲突、重名、终态再提交或状态不允许 |
| resource_in_use | 1004 | 409 | 活动或受引用资源不能删除 |
| unsupported_device | 1005 | 422 | auto、缺失设备或不支持的设备表达 |
| unsupported_capability | 1006 | 501 | 专业能力、任务或图类型未实现 |
| provider_unavailable | 1007 | 503 | 已支持能力的解释器或运行环境未就绪 |
| integration_precondition_failed | 1008 | 409 | 划分不一致、数据不可读或 provider 版本不匹配 |
| cursor_invalid | 1009 | 409 | 增量源已替换/截断或游标不属于该资源 |
| storage_corrupt | 1010 | 500 | 文档或受控产物损坏 |
| storage_busy | 1011 | 503 | 短暂存储锁冲突超过等待时间，可显式重试 |
| no_ground_truth | 1012 | 422 | 散点图没有可用真值预测配对 |
| needs_reconciliation | 1013 | 409 | 进程身份或启动结果需要核对 |

分页 data 为 items/total/page/page_size。page>=1，page_size 默认 50、上限 200。
默认 created_at、id 降序，队列按 queue_order、experiment_id 升序。
字符串筛选默认精确匹配，q 为名称/文件名包含检索；不接受客户端 SQL、任意排序表达式或配置 JSON 查询路径。

## 资源与划分

| Method | Path | 语义 |
| --- | --- | --- |
| GET / POST | /data-sources | 列表或登记已允许 root_alias 的来源 |
| POST | /data-sources/{source_id}/import | 登记标准资源清单；返回 imported/existing/错误明细 |
| GET | /batteries | 按 source_id、q、chemistry、material、temperature_c、nominal_capacity_ah 分页 |
| GET | /batteries/{battery_id} | 详情与可用性；不读取训练用 pickle |
| GET / POST | /splits | 列表或按手动/随机/混合方式创建划分 |
| POST | /splits/import | multipart：source_id、file；导入 provider 四字段划分 JSON |
| GET / PUT / DELETE | /splits/{split_id} | 查询指定/当前版本；完整更新产生新版本；受引用时禁止删除 |
| GET | /splits/{split_id}/members | 按 version、partition 分页查成员 |
| GET | /splits/{split_id}/export | 下载指定版本 provider 划分 JSON |

资源导入先校验整份身份和引用，矛盾清单整体拒绝，不部分改变资源；相同来源+文件名幂等。
成功时 errors=[]；整批拒绝返回错误 envelope，details.errors 列逐项原因且 imported=0。
split 写入包括 source_id、name、battery_ids、method、partitions、ratios、seed；
manual 使用 partitions，random/hybrid 使用 ratios 和 seed，hybrid 的 partitions 为固定成员。
更新额外要求 expected_revision。详情返回 head_version、revision、counts，完整成员通过 members 或文档详情读取。
所有版本引用统一为 `{"id":"UUID","version":1}`，不使用物理文件名充当公共资源 ID。

## 模板、实验与队列

| Method | Path | 语义 |
| --- | --- | --- |
| GET / POST | /templates | 查询或保存 native_config；保存不启动专业校验或训练 |
| POST | /templates/import | multipart：name、file；安全解析 YAML/JSON 并创建模板 |
| GET / PUT / DELETE | /templates/{template_id} | 查询、版本化更新、受引用保护删除 |
| GET | /templates/{template_id}/export | 下载 YAML 配置，不保证原注释和排版往返 |
| GET / POST | /experiments | 常用字段分页或创建可编辑草稿 |
| POST | /experiments/import | multipart：name、kind、bindings(JSON 字符串)、file；导入配置创建草稿 |
| GET / PATCH / DELETE | /experiments/{experiment_id} | 查询、带 expected_revision 的草稿修改或删除记录 |
| POST | /experiments/{experiment_id}/validate | 返回 valid/errors/warnings/能力条件；不创建执行目录和进程 |
| POST | /experiments/{experiment_id}/copy | 复制输入为新 draft，不复制执行/结果 |
| GET | /experiments/{experiment_id}/export | 下载草稿或冻结业务配置 YAML；实际执行配置作为 artifact 查询 |
| POST | /queue/submissions | experiment_ids 按提交顺序入队，全批新项成功或全批拒绝 |
| GET | /queue | 返回 waiting、active、dispatch_paused 及原因 |
| POST | /experiments/{experiment_id}/stop | 排队取消或接收运行停止，幂等返回当前状态 |

实验写入含 name、kind、native_config、bindings；bindings 包含 split、source_split、target_split、
checkpoint_id、template。草稿可保留未完成字段，执行前按 kind 检查所需引用和真实能力。
引用的模板若被选用，创建时读取指定版本并保存草稿副本；不能让后续模板修改改变实验。
kind 缺省 train。未提供 native_config 且绑定模板时复制模板；显式 native_config 完整替代，
不做隐式深合并；无模板也无配置时保存空草稿，执行校验仍要求完整输入。
native_config 与 bindings 的数据选择必须在校验/导出时一致，不允许静默选用其他划分。

GET /experiments 筛选 q、source_id、split_id、model_type、task_type、state、requested_device、
created_from、created_to、source_domain、target_domain；完整超参数不进入动态筛选。
详情包含 revision、配置版本、绑定版本、requested_device、可空 effective_device、执行和采集状态。
execution 包含停止请求/阶段和退出信息；collection 包含 status/error，采集错误与执行终态分别表达。

validate 对正常完成的检查返回 200（valid 可为 false）；执行环境不可用返回 503。
队列只接受执行校验通过的草稿；活动项重复提交返回其现有状态，不新增启动意图。
列表含终态、无效资源或不支持设备时，新草稿全部不入队；可返回每项原因。
不允许终态实验重新执行或覆盖结果；copy 是唯一重跑入口。

DELETE experiment 只删除不被引用且已终结或未执行的记录；默认不清理物理产物，
保留孤立产物用于人工清理，不新增自动删除模型文件的隐式行为。

## 组件、权重、日志与结果

| Method | Path | 语义 |
| --- | --- | --- |
| GET | /capabilities | 当前 provider、操作、版本、支持范围和限制 |
| GET | /components | scope 可选；返回真实目录，不构造组件 |
| GET | /components/{scope}/{type}/schema | 组件参数描述，保留注入项/required/default/configurable |
| POST | /components/uploads | multipart：scope、file；复用上传工具，默认最大 1 MiB |
| GET / POST | /checkpoints | 查询或上传登记权重；POST multipart：file、component_id、可选 source_experiment_id |
| GET | /experiments/{experiment_id}/logs | stream=train/console、cursor、limit_bytes；最大单次 64 KiB |
| GET | /experiments/{experiment_id}/logs/stream | SSE 按相同日志游标持续输出，支持 Last-Event-ID |
| GET | /experiments/{experiment_id}/metrics | stage/name/after_epoch/page/page_size 过滤的轮次指标 |
| GET | /experiments/{experiment_id}/results | 当前结果及来源版本、缺失原因、指标和预测 |
| GET | /experiments/{experiment_id}/artifacts | 产物资源列表；不在每次查询时全目录扫描 |
| GET | /artifacts/{artifact_id}/download | 只下载允许根中的已登记普通文件；目录型权重按子产物枚举，不自动打包 |

权重上传默认最大 1 GiB（部署可调整），流式保存并计算校验值，不反序列化或执行模型。
组件上传返回 activation、sha256 和 components 数组，可包含同一源码的多个注册声明。
组件预览与静态上传不要求科学运行环境；动态 schema 需使用实际兼容的训练解释器。
普通文件被允许根约束，符号链接解析后的目标也不能越界；绝对服务器路径不作为请求参数。

LogChunk data 为 stream、text、next_cursor、eof、state。游标是编码后的版本化位置，
与实验/日志身份绑定；不接受任意路径。UTF-8 在完整字符边界分块，未知文件版本返回 cursor_invalid。
正在运行时无新内容可返回空 text 与 eof=false；终态且内容读尽才 eof=true。

SSE 使用 event=log/state/end/error，log 的 id 为 next_cursor；data 为 JSON LogChunk 或状态信息。
Last-Event-ID 优先于首次 cursor 参数；两者指向不同实验/源则拒绝。断线可能重放，客户端按 cursor 去重。
结束前最后一次读取剩余内容再发 end；流建立后的错误发 error 事件，不伪装成成功结束。

## 比较、基础分析与图表

| Method | Path | 语义 |
| --- | --- | --- |
| POST | /comparisons | experiment_ids、可选 metrics/battery_ids；返回 ComparisonData |
| POST | /comparisons/export | 同一请求加 format=json/csv；下载结构化比较数据 |
| POST | /differences | 集合引用、analysis_kind、可选 category；返回真实 DifferenceResult |
| POST | /charts | chart_type 及实验/集合引用，按类型需要 metric/stage/category；返回 ChartBundle |

集合引用为 label、split（指定版本）、partitions（缺省三个分组）；至少一个集合。
counts/overlap/category_distribution 为基础分析；category 限 source、chemistry、material、temperature_c。
ComparisonData 的缺失值为 null，按来源身份对齐；原指标值和单位不隐式转换。
Result 和 ComparisonData 返回 sources，包含 experiment_id、result_version、source_artifact_id、source_hash；
没有结果时 version=null、sources=[]。/metrics 只返回轮次指标，/results 和普通比较只取最终指标。
Result 的 best_epoch 保留原始最佳轮次，即使没有聚合指标也不会丢失。
无法从冻结资源绑定解析的预测身份使用实验隔离的 opaque ID，并返回 warnings；battery_ids 过滤因此接受字符串 ID。
CSV 使用长表：record_type、experiment_id、stage、epoch、metric_name、value、unit、granularity、
battery_id、prediction、target；不适用字段为空，不能写 0 冒充缺失。响应携带附件文件名。

chart_type 为 metric_bar、epoch_line、prediction_scatter、set_count_bar、category_bar、overlap_bar；
metric_bar/epoch_line 需 metric 和 stage；prediction_scatter 需至少一组真实预测配对。
不同单位/粒度分面，多图返回 charts 数组。完整类型见 OpenAPI 与 capabilities.md。

## 契约与演进

公共 JSON DTO 不暴露内部字段，未知写入字段返回 422；native_config 和已声明 metadata 是明确的扩展内容。
HTTP DTO、OpenAPI 和实现同步维护；未来不兼容变更使用新 API 版本。能力替换保持这些业务 DTO，
provider 专属错误、目录和配置细节通过适配器转换。
