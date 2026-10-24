# Tasks: 电池实验平台后端首版业务

**Input**: spec.md、plan.md、research.md、data-model.md、contracts/、quickstart.md
**Tests**: 用户明确要求 TDD；每项业务先运行预期失败测试，再实现、回归、重构。
**Status**: 已完成 37/37 项。勾选表示代码与相应验证完成；真实训练环境缺口另列。

## Phase 1: Setup

- [x] T001 配置 Python >=3.14、FastAPI/SQLAlchemy/Alembic 等运行依赖及 pytest/Ruff/mypy 检查于 pyproject.toml，保留 src/deeplatform 不变
- [x] T002 建立类型化设置、包入口及应用装配的最小签名于 src/batteryland/main.py 和 src/batteryland/config.py；配置源别名、运行根、独立训练解释器，默认单 worker

## Phase 2: Foundational

- [x] T003 先在 tests/integration/test_storage.py 写失败行为测试，验证不可变文档、提交失败旧引用、外键、回滚及迁移
- [x] T004 在 src/batteryland/infrastructure/persistence/ 实现 ORM 映射、短 Session 和业务仓储，src/batteryland/infrastructure/persistence/migrations/ 建立 Alembic 基线；不以 create_all 替代版本迁移
- [x] T005 在 src/batteryland/infrastructure/documents.py 实现 JSON 不可变版本发布、哈希校验、写锁及安全孤儿清理
- [x] T006 在 src/batteryland/domain/ 和 src/batteryland/interfaces/api/ 建立领域错误、API DTO、统一错误映射及依赖装配，业务层不依赖 ORM/Pydantic

## Phase 3: US1 — 已有资源入库与检索

**Goal**: 来源+文件名幂等登记，来源身份隔离，已有分类检索。
**Independent Test**: 固定清单重复导入、跨来源同名和缺失文件查询。

- [x] T007 [US1] 先在 tests/integration/test_resources.py 验证重复导入、矛盾清单整体失败、分类分页与未知数据可用性
- [x] T008 [US1] 在 src/batteryland/application/resources.py 实现来源/电池用例及查询；保持 unique(source_id,file_name) 和稳定身份
- [x] T009 [US1] 在 src/batteryland/interfaces/api/resources.py 实现来源、清单导入与电池 HTTP 接口，禁止路径越界和查询时读取原始 pickle

## Phase 4: US2 — 可复现的数据划分

**Goal**: 手动、随机、混合划分，版本与引用保护。
**Independent Test**: 固定输入、种子重现，拒绝重叠，导出四字段。

- [x] T010 [US2] 先在 tests/unit/test_splits.py 验证物理电池分配单元、shuffle-v1 舍入和混合固定项，再在 tests/integration/test_splits_api.py 验证版本与导出
- [x] T011 [US2] 在 src/batteryland/domain/splits.py 实现确定性划分与父关系冲突规则；空分组保留，固定项超目标拒绝
- [x] T012 [US2] 在 src/batteryland/application/splits.py 和 src/batteryland/interfaces/api/splits.py 实现成员投影、导入导出、expected_revision 更新与受引用保护

## Phase 5: US3 — 模板、实验草稿与检索

**Goal**: 配置先入库，版本明确，保存与执行校验分开。
**Independent Test**: 草稿往返、模板编辑隔离、修订冲突、配置拒绝及筛选。

- [x] T013 [US3] 先在 tests/integration/test_experiments.py 验证配置/模板版本、复制、冲突、auto 拒绝和历史输入不变
- [x] T014 [US3] 在 src/batteryland/application/configurations.py 实现模板与草稿 CRUD、YAML 安全导入导出及绑定版本
- [x] T015 [US3] 在 src/batteryland/application/experiments.py 实现校验、快照冻结、引用保护与一次执行规则；任务组件决定必要数据条件
- [x] T016 [US3] 在 src/batteryland/interfaces/api/experiments.py 实现配置/实验接口和固定业务字段查询，不扫描全部文档构建列表

## Phase 6: US4 — 串行实验生命周期

**Goal**: 最多一个活动执行，重复提交不重复启动，停止和恢复真实可核实。
**Independent Test**: 受控短进程 A/B/C、十次重复提交、信号升级及不确定恢复。

- [x] T017 [US4] 先在 tests/integration/test_scheduler.py 验证 FIFO、批次原子性、重复提交、停止竞态及重启不重跑
- [x] T018 [US4] 在 src/batteryland/domain/experiments.py 实现状态机，持久化条件认领 queued→starting，needs_reconciliation 不允许回队列
- [x] T019 [US4] 在 src/batteryland/infrastructure/scheduling.py 实现本地串行、运行根独占锁、所属进程身份核验与停止阶段/期限
- [x] T020 [US4] 在 src/batteryland/application/execution.py 实现运行输入导出、启动意图/回执、协调循环及队列恢复；明确设备不得改写
- [x] T021 [US4] 在 src/batteryland/interfaces/api/execution.py 和 src/batteryland/main.py 提供入队、队列、停止与本机核实维护入口

## Phase 7: US5 — 训练组件与权重接入

**Goal**: 复用 provider 目录、上传、校验和 prepare，训练环境独立。
**Independent Test**: 结构化桥接、跨根重名、权重校验和固定版本契约。

- [x] T022 [US5] 先在 tests/contract/test_training.py 验证桥接、目录字段、组件静态上传与不满足训练前置条件的拒绝
- [x] T023 [US5] 在 src/batteryland/infrastructure/training/ 实现独立解释器桥接与 TrainingGateway，复制运行数据标签到受管工作区，不改子模块
- [x] T024 [US5] 在 src/batteryland/application/artifacts.py 和 src/batteryland/interfaces/api/components.py 实现目录、上传、权重登记及受控下载

## Phase 8: US6 — 采集、日志与结果查询

**Goal**: 完整记录增量采集、幂等结果版本、来源与单位保真。
**Independent Test**: 半行补全、重复采集、文件替换、SSE 游标和可选产物缺失。

- [x] T025 [US6] 先在 tests/integration/test_results.py 验证导入代次/位置去重、轮次与最终指标区分、比率/百分数和缺失值
- [x] T026 [US6] 在 src/batteryland/application/results.py 实现结果版本、指标投影、采集游标和产物登记，Metric 区分 record_type=epoch/final
- [x] T027 [US6] 在 src/batteryland/interfaces/api/results.py 实现指标、结果、产物及日志游标/SSE，确认终态读尽才发 end

## Phase 9: US7 — 结果比较、差异分析与图表

**Goal**: 真数据基础实现；并集、空值、单位和粒度保持可解释。
**Independent Test**: MAPE/ABC 与 MAE、不同电池名单、无真值及基础集合图。

- [x] T028 [US7] 先在 tests/unit/test_analysis.py 验证指标/电池并集、未知单位隔离、无真值拒绝与真实集合统计
- [x] T029 [US7] 在 src/batteryland/application/analysis.py 实现 ComparisonData 与长表 CSV/JSON 导出
- [x] T030 [US7] 在 src/batteryland/infrastructure/analysis.py 实现 basic-difference/v1 和 basic-charts/v1，ChartSpec 不含可执行代码
- [x] T031 [US7] 在 src/batteryland/interfaces/api/analysis.py 实现比较、差异、图表和导出接口，未知能力明确报错

## Phase 10: Polish & Cross-Cutting Concerns

- [x] T032 在 src/batteryland/main.py 实现 init/serve/import-bundled/reconcile 命令，README.md 提供可执行使用入口
- [x] T033 在 tests/contract/test_api.py 和 tests/integration/test_workflow.py 验证真实 HTTP 主流程、迁移重启与 1,001 电池/100 实验查询基准
- [x] T034 将实际生成的 OpenAPI 与 specs/001-backend-experiment-platform/contracts/openapi.json 对齐并运行契约检查
- [x] T035 执行相关 pytest、Ruff、mypy、构建及服务冒烟，更新 specs/001-backend-experiment-platform/quickstart.md 的真实证据与训练缺口

## Dependencies & Execution Order

Setup → Foundational → US1 → US2 → US3 → US4 → US5 → US6 → US7 → Polish。
用户故事验收用固定资源和受控能力独立构造前置状态，不能因其他功能未真实接入而伪造完成。
US4 的进程控制先用受控任务验证，US5 再接 provider；二者复用同一能力契约。

## Parallel Examples

本次按依赖串行实现；不同测试文件可独立运行。各故事的领域测试与 HTTP 契约测试可并行验证，
同一业务仓储、应用文件和契约的修改保持顺序，避免互相覆盖。调研代理只读，不修改实现。

## Implementation Strategy

每个故事先写有效失败测试，再实现公开行为；每一阶段完成后运行受影响测试并记录证据。
持续更新本任务文件的状态，不在完成规格后停止。按维护者最新授权，功能验收通过后
及时提交、合入本地主分支并清理已合并的任务分支；推送远程仍需单独授权。
首次交付包括全部七个故事的后端基础功能；真实训练接口缺口按文档保留，
不能将不可用的自定义划分/评估/迁移宣称已经真实运行。

## Verification Log

- 2026-10-23：设计内容检查通过，7 用户故事、34 功能要求、8 成功标准；OpenAPI 48 操作的 JSON schema/ref 检查通过。
- 2026-10-23：requirements.md 16 项规格质量审阅通过；尚未运行应用测试。

- 2026-10-23：文档仓储预期失败 3 项 → 3 passed；迁移/外键/事务回滚预期失败 1 项 → 总计 4 passed（Python 3.14，临时 SQLite）。

- 2026-10-23：错误响应测试 2 项、资源用例测试 3 项先失败再通过；当前合计 9 passed。ASGI TestClient 需允许线程唤醒的执行环境；Ruff 和 mypy 通过。

- 2026-10-24：US2 的 6 项测试先失败再通过；以 returning 条件更新修复 SQLAlchemy 类型检查，现有 15 项回归及静态检查重新核对。

- 2026-10-24：US3 配置/模板 3 项及 US4 FIFO、重复提交、终止与重启 3 项完成红绿验证；修复进程退出与 /proc 扫描间的竞态。CLI 核实入口仍在后续任务。

## Phase 11: Convergence

- [x] T036 按 FR-015、FR-018 和 contracts/capabilities.md 补齐 PreparedExecution/ExecutionReceipt 的 intent_id、input_manifest_sha256、provider_config_sha256，在本机恢复时核对回执与输入清单一致，并添加篡改拒绝测试（partial，HIGH）
- [x] T037 按 FR-023 和 contracts/http-api.md 同时校验 SSE 的 cursor 与 Last-Event-ID 对当前实验/日志源的归属，保持 Last-Event-ID 的位置优先级；添加错误归属回归测试（partial，MEDIUM）


## Final Verification — 2026-10-24

- US5 静态桥接、跨根重名和上传、权重登记/下载先失败再通过；真实 provider 参数描述不构造组件、不导入 torch。
- US6 半行 JSONL、重复采集、代次替换、坏结果保留旧头、来源归档、UTF-8 和 SSE 均完成回归；损坏最终文件不阻塞有效轮次指标。
- US7 比较并集、null、自定义指标、单位/粒度分面、无真值拒绝、真实集合统计及声明式图表完成红绿验证。
- CLI init/import-bundled/reconcile 已验证；内置 1,001 条电池、23 份划分重复导入幂等。运行根锁释放、准备/停止竞态、回执恢复与整个进程组停止通过。
- T036/T037 两项收敛发现先复现失败再修复；恢复时拒绝意图、清单和准备配置哈希不一致，SSE 同时验证两种游标归属。
- 最终 pytest：57 passed，21.09s；Starlette 的 HTTPX 弃用提示 1 条。Ruff 检查/格式与严格 mypy（65 个源文件）通过。
- 查询样例：1,001 电池 / 23 划分 / 100 实验；100 次常用查询 p95=0.018041s。保护断言拒绝读取文档和扫描产物目录。
- 37 路径 / 48 操作的 OpenAPI 与实际应用一致；文档链接、checklist 16/16、桥接 Python 3.10 语法和 git diff --check 通过。
- sdist/wheel 构建通过；隔离安装内容可执行内置 Alembic 迁移。临时真实 HTTP 服务验证导入、草稿、预览、503/501、OpenAPI 及重启持久化。
- deeplatform 子模块无修改；未运行真实电池训练或 GPU 联调，未配置科学依赖训练解释器。全部接入限制见 research.md 与 quickstart.md。
- 保留现有暂存改动；本次没有提交、推送或向外部贡献者发送消息。
