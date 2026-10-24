# Tasks: 共享环境真实训练联调

**Input**: spec.md、plan.md、research.md、data-model.md、contracts/runtime.md
**Status**: 已完成17/17，含ty/CUDA工具链更新。代码与真实执行分别验证，不修改子模块；按维护者最新授权完成本地提交与合并。

## Phase 1: Setup

- [x] T001 建立 specs/002-shared-training-runtime/ 规格、设计、契约与16项质量审阅，保留001历史。

## Phase 2: Foundational

- [x] T002 在 tests/contract/test_shared_runtime.py 先复现控制/启动未使用当前解释器、环境身份不匹配及符号链接问题。

## Phase 3: US1 — 共享环境

**Goal**: 当前解释器和依赖统一，科学导入仍隔离进程。
**Independent Test**: 静态检查、控制响应prefix与实际工作进程身份。

- [x] T003 [US1] 修改 src/batteryland/config.py 与 infrastructure/training/gateway.py，移除第二解释器，使用sys.executable原路径。
- [x] T004 [US1] 在 src/batteryland/infrastructure/training/bridge.py 报告运行身份；gateway验证prefix（必须等于当前sys.prefix），prepare保存runtime。
- [x] T005 [US1] 在 pyproject.toml 建立training组与dev+training默认组，统一uv.lock并安装兼容依赖，不改变Python基线。
- [x] T006 [US1] 更新 tests/integration/test_components.py 的不可用模拟，验证真实目录与API进程不加载torch；缺包必须有明确错误。

## Phase 4: US2 — CPU/GPU真实任务

**Goal**: 真实MyTask与CALCE13电池单轮CPU/cuda:0。
**Independent Test**: 原生结果、预测和来源能经API追溯。

- [x] T007 [US2] 在 tests/training/ 编写显式开启的真实provider目录、MyTask、CALCE输入、设备及结果验收；普通pytest不分配GPU或读取原始pickle。
- [x] T008 [US2] 用根环境运行 src/deeplatform/tests/ 自带测试，记录版本兼容与源码约束，不修改provider。
- [x] T009 [US2] 执行真实MyTask与CALCE单轮CPU验收，经现有API核验指标/预测/权重与原始产物一致。
- [x] T010 [US2] 执行明确cuda:0的真实CALCE验收，记录GPU PID/UUID与训练设备日志，禁止静默CPU或重编号。
- [x] T011 [US2] 若真实运行揭示宿主缺陷，先在 tests/ 增加失败回归再修改负责的 src/batteryland/ 层；provider缺口写入 research.md。

## Phase 5: US3 — 真实生命周期

**Goal**: 重启不重跑、停止确认所属进程组退出。
**Independent Test**: 同一个真实长实验跨服务恢复保持intent与PID。

- [x] T012 [US3] 在 tests/training/ 验证真实实验重启/停止，用原始执行身份及整个进程组退出断言，不只检查状态字符串。

## Phase 6: Polish

- [x] T013 更新 README.md、当前使用说明及 specs/002-shared-training-runtime/quickstart.md，记录真实环境、成功与受阻项。
- [x] T014 执行 tests/ 原有回归、共享契约、Ruff、mypy、构建、OpenAPI一致性与子模块差异检查；收敛复核全部FR/SC。

## Dependencies & Parallel Examples

T001→T002→T003/T004→T005/T006→T007→T008/T009→T010→T012→T013/T014。
只读依赖和数据研究可并行；实现和真实训练串行，共享数据/设备只允许一个实验。

## Implementation Strategy

先完成US1作为可独立验证增量，再真实CPU/GPU，最后真实生命周期。
失败按宿主、provider、数据、环境归因；不以替身验证填充真实成功。
功能验收通过后及时提交、合入本地主分支并清理已合并的任务分支；推送远程仍需单独授权。

## Verification Log

- 2026-10-24：只读确认CALCE13文件及标签/前100循环结构，GPU0可访问；尚未训练。

- 2026-10-24：共享环境4项契约测试先失败再通过；普通回归61 passed/4 skipped，provider原生96项测试通过。Python3.14.7及所有直接依赖和准确导入符号可用；GPU初始化需进一步核查。

- 2026-10-24：真实MyTask 1 passed（26.84s）；CALCE CPU 1 passed（26.75s）与cuda:0 1 passed（26.84s），每个21指标/2预测。GPU PID671136对应物理GPU0 UUID。实际CPU先暴露采集组件provider_commit漏映射，新增回归先失败再通过后修复宿主应用层。

- 2026-10-24：真实HTTP API进程重启/停止 1 passed（28.48s），训练PID671659与intent不变；62普通测试通过、4真实测试默认跳过，四个真实验收分别显式通过。Ruff/mypy、锁定同步、sdist/wheel构建与git diff --check通过；子模块干净且无pyproject新增。

## Phase 7: 类型检查与 CUDA 构建更新

- [x] T015 在 pyproject.toml 用ty替换mypy，保持src/batteryland检查范围和warning失败门槛；修正迁移诊断，同步README及宪章，保留历史检查记录。
- [x] T016 在 pyproject.toml、uv.lock 将官方torch构建由cu126切换cu130，保留PyTorch2.14.1与共享环境，验证驱动及实际CUDA。
- [x] T017 执行ty、Ruff、普通回归、provider测试和真实GPU训练，更新 quickstart.md 的当前配置与实测证据，不改子模块。

- 2026-10-24：ty默认检查的3处类型诊断与3处生成器注解弃用提示已修正；ty0.0.91检查通过，不添加忽略规则。
- 2026-10-24：共享环境已切换torch2.14.1+cu130，移除mypy及其专属依赖；CUDA探针错误期望16已更正为8，不能将该断言失败归因为驱动/初始化失败。普通回归62 passed/4 skipped，CUDA13完整验收进行中。

- 2026-10-24：CUDA13完整真实验收4 passed（121.26s），GPU训练PID678849与物理GPU0 UUID匹配，真实HTTP重启/停止保持训练PID679055。provider96项测试通过（22.009s），ty0.0.91、Ruff、构建和差异检查通过，17/17完成。
