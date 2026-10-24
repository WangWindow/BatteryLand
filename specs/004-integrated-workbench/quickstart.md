# 工作台运行与验收

后端：仓库根目录`uv sync`、`uv run batteryland init --data-dir ./var`、`uv run batteryland serve --data-dir ./var`。
前端：`cd src/batteryland_ui`，`bun install --frozen-lockfile`、`bun run dev`。调度随后端运行，无单独服务。

允许来源由BATTERYLAND_SOURCE_ROOTS配置，网页从别名选项选择。原生JSON作为高级入口；常用实验参数由表单控件完成。

检查：根目录pytest/Ruff/ty；前端`bun run verify`、`bun run test:e2e`。`generate:api`根据004当前快照生成类型。
类型工具链使用TypeScript6.x以兼容openapi-typescript所需的经典编译器API，包版本锁定于bun.lock。

## 实测记录

- 后端74 passed/4 skipped，Ruff与ty通过；派发无需HTTP，来源选项不暴露物理路径。
- 前端迁移和交互验收进行中。
