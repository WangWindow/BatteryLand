# Tasks: 模块化实验工作台闭环

**Input**: spec.md、plan.md、research.md、data-model.md、contracts/。
**Tests**: 遵循TDD，先观察有效失败，再实现行为；文档和依赖配置采用内容/构建检查。
**Status**: 引擎派发、独立scheduler、模块化工作台、i18n与真实HTTP浏览器验收已完成；真实CPU/GPU训练验收待执行。

## Phase 1: Setup

- [x] T001 在 specs/003-modular-workflow/spec.md、coverage.md、checklists/requirements.md 建立并审阅规格，独立提交。
- [x] T002 在 specs/003-modular-workflow/plan.md、research.md、data-model.md、contracts/、quickstart.md 记录只读研究与明确设计，生成本任务清单。

## Phase 2: 引擎基础与US3 — 独立派发

**Goal**: 外部选择任务，引擎独占执行状态和进程。
**Independent Test**: 公开HTTP派发、重复十次、并发不同任务、准备时停止、无scheduler仍能观察停止。

- [x] T003 [US3] 先在 tests/integration/test_dispatch.py 增加派发有效失败测试，覆盖expected_revision>=1、未知字段拒绝及容量1。
- [x] T004 [US3] 修改 src/batteryland/application/execution.py、bootstrap.py、interfaces/api/execution.py，增加派发并将tick限制为观察/停止/采集，移除内嵌策略。
- [x] T005 [US3] 更新 tests/integration/test_scheduler.py、test_recovery.py、tests/contract/test_api.py，改用HTTP驱动并导出 specs/003-modular-workflow/contracts/openapi.json，保留001历史快照。
- [x] T006 [US3] 在 tests/unit/test_scheduler_client.py 验证FIFO选择、HTTP冲突/超时恢复和策略替换。
- [x] T007 [US3] 在 src/simple_impl/scheduler/ 实现独立HTTP调度CLI；pyproject.toml、uv.lock 声明scheduler依赖组和ty范围，无引擎内部导入。

## Phase 3: 前端基础

- [x] T008 在 src/simple_impl/ui/ 使用官方shadcn初始化单Vite应用，安装Bun/Biome/测试依赖，清除模板ESLint，配置冻结锁和忽略产物。
- [x] T009 在 src/simple_impl/ui/tests/ 验证API envelope、业务错误、取消和日志游标恢复。
- [x] T010 在 src/simple_impl/ui/src/api/、components/、App.tsx 建立生成DTO、统一客户端、查询生命周期、主题和懒加载工作台导航。

## Phase 4: US1 — 资源与划分

**Goal**: 网页资源准备及版本化划分。
**Independent Test**: 来源登记、清单导入、分页检索、划分创建/修改/导入导出及错误展示。

- [x] T011 [US1] 在 src/simple_impl/ui/tests/ 验证来源导入、筛选及划分修订冲突的用户行为。
- [x] T012 [US1] 在 src/simple_impl/ui/src/pages/ 实现Resources和Splits页面，来源/成员选择与有标签的高级输入分离。

## Phase 5: US2 — 配置与组件

**Goal**: 网页配置准备与准确校验。
**Independent Test**: 模板编辑、组件参数/上传、权重登记、实验创建/保存/校验/复制。

- [x] T013 [US2] 在 src/simple_impl/ui/tests/ 验证配置JSON拒绝、模板绑定、上传失败及实验状态操作。
- [x] T014 [US2] 在 src/simple_impl/ui/src/pages/ 实现Templates、Components、Experiments页面，调用既有接口而非本地文件或provider内部函数。

## Phase 6: US4 — 监控和结果

**Goal**: 队列、停止、日志、结果与下载。
**Independent Test**: 日志增量、切换实验取消旧请求、停止状态、结果/采集状态及产物下载。

- [x] T015 [US4] 在 src/simple_impl/ui/tests/ 验证日志缓冲最多256KiB、游标重置和卸载清理。
- [x] T016 [US4] 在 src/simple_impl/ui/src/pages/、src/api/ 实现队列和实验详情，日志游标轮询与原始结果/预测/产物展示。

## Phase 7: US5 — 浏览器可视化

**Goal**: 六种真实数据图表和比较导出。
**Independent Test**: null、未知指标、不同名单、单位分面、无真值及实际SVG交互。

- [x] T017 [US5] 在 src/simple_impl/ui/tests/ 验证图表转换、缺失值和每序列最多1000点且保留缺失断点的采样行为。
- [x] T018 [US5] 在 src/simple_impl/ui/src/visualizer/ 与 src/pages/ 实现六种图型、集合选择、图例/tooltip与JSON/CSV导出，仅动态导入绘图库。

## Phase 8: US6 与端到端验收

**Goal**: 验证模块边界、真实浏览器和训练链路。
**Independent Test**: 浏览器经真实HTTP驱动独立scheduler和训练；普通页不下载chart chunk。

- [x] T019 [US6] 在 src/simple_impl/ui/e2e/ 建立真实HTTP资源/配置/执行/比较和懒加载失败验收；受控训练夹具仅在测试服务中使用。
- [x] T020 [US6] 在 src/simple_impl/ui/e2e/、tests/ 集成实际浏览器、后端和独立scheduler，修复验收揭示的本轮问题并验证窄屏与键盘状态。
- [ ] T021 [US6] 更新 tests/training/test_real_training.py，经独立scheduler及真实provider执行CPU/GPU、HTTP重启/停止与浏览器MyTask验收，不改deeplatform。代码已改为scheduler派发；本机未执行真实CPU/GPU。

## Phase 9: 收尾

- [x] T022 执行 pytest/Ruff/ty、Biome/tsc/Vitest/build/Playwright、构建及契约漂移检查；更新 README.md、specs/003-modular-workflow/quickstart.md 与 coverage.md 的实测状态。真实训练缺口见T021，故暂不合入main。

- [x] T023 前端国际化：新增简体中文/英文词典、语言切换与持久化；`scripts/check-i18n.ts`验证键树、占位符、引用和硬编码文本；同步更新宪章、规格、计划、契约与README。

## Dependencies & Parallel Examples

T001→T002→T003/T004/T005→T006/T007→T008/T009/T010→US1/US2/US4→US5→US6→T022。
只读研究已并行；实现和共享环境变更保持串行。不同纯函数测试可并行，真实训练串行且不与其他实验争用设备。

## Implementation Strategy

引擎接口、独立scheduler、前端基础和用户故事按可验证增量分别提交，不将整个feature再次合成单个大提交。
全部验收通过后合入本地main并删除已合并分支；不自动推送远程。

## Verification Log

- 2026-10-24：规格16项质量审阅通过；两个只读研究完成；尚无本轮实现或测试成功声明。

- 2026-10-24：派发6项先有效失败，再与串行/恢复回归共13 passed；完整后端68 passed/4 skipped，ty/Ruff通过，当前OpenAPI49操作。
- 2026-10-24：scheduler客户端3组测试通过；独立scheduler CLI接入pyproject依赖组与ty范围（src/simple_impl/scheduler）。
- 2026-10-24：工作台页面、API客户端、日志游标、visualizer、i18n与测试完成；前端20 passed，typecheck/Biome/i18n（624键）/build通过。
- 2026-10-24：Playwright真实HTTP栈4 passed：来源/清单/划分/模板/实验/执行/日志/结果/产物/六图/停止/中英文/窄屏键盘/懒加载失败。受控训练夹具仅用于E2E测试服务。
- 2026-10-24：完整后端76 passed/4 skipped，Ruff/ty通过。真实CPU/GPU训练未执行，T021保持未完成，不将E2E受控训练冒充真实provider验收。
