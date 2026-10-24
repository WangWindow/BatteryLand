# 工作台运行与验收

后端：仓库根目录`uv sync`、`uv run batteryland init --data-dir ./var`、`uv run batteryland serve --data-dir ./var`。
前端：`cd src/batteryland_ui`，`bun install --frozen-lockfile`、`bun run dev`。调度随后端运行，无单独服务。

允许来源由BATTERYLAND_SOURCE_ROOTS配置，网页从别名选项选择。原生JSON作为高级入口；常用实验参数由表单控件完成。

检查：根目录pytest/Ruff/ty；前端`bun run verify`、`bun run test:e2e`。`generate:api`根据004当前快照生成类型。
类型工具链使用TypeScript6.x以兼容openapi-typescript所需的经典编译器API，包版本锁定于bun.lock。

## 实测记录

- 后端74 passed/4 skipped，Ruff与ty通过；派发无需HTTP，来源选项不暴露物理路径。
- 前端26项测试、TypeScript/Biome/i18n、OpenAPI类型生成与生产构建通过。
- 浏览器受控HTTP流程4项通过（51.5s）：资源、划分、模板、执行、日志、结果、产物、六图、中英文、停止、窄屏与懒加载恢复。
- 真实训练4项通过（130.15s）：MyTask、CALCE CPU/cuda:0、真实HTTP重启/停止；实际GPU PID与UUID核对一致。
- 真实浏览器MyTask1项通过（26.8s），训练由原始deeplatform执行。
- 实际截图检查默认表单、来源管理与筛选的展开行为；原生配置、能力细节和数据明细按需展示。
- 后端包构建、差异检查通过。

## 交互变化

实验和模板共用常用参数控件；仅修改对应配置字段，保留未知字段与引用。模板按选中版本读取，过期响应不覆盖新选择，加载期间不能误保存。
来源从后端允许别名选择；图表指标从实际数据选择，集合图不依赖实验选择。来源管理、更多筛选、能力与结果明细默认收起。
高级配置仍可用于自定义组件和非标准参数；自定义划分执行、auto、多卡并行、独立评估与迁移的provider限制保持明确。
