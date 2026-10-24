# Quickstart: 模块化实验工作台

## 启动

在仓库根运行`uv sync`和`uv run batteryland init --data-dir ./var`。
配置允许来源后启动`uv run batteryland serve --data-dir ./var`，另开终端执行`uv run python -m simple_impl.scheduler`。
前端在`simple_impl/ui`运行`bun install --frozen-lockfile`与`bun run dev`，打开http://127.0.0.1:5173。
前端开发和preview通过代理访问后端；生产部署将/api代理到独立后端，不把页面嵌入引擎。

## 验收

1. 来源登记、清单导入、筛选，创建/修改/导出/导入划分。
2. 模板导入/编辑，组件预览/上传、权重登记与下载。
3. 从模板创建实验，校验并入队；独立scheduler驱动执行。默认MyTask可进行真实CPU最小闭环，CALCE使用既有原生划分。
4. 观察日志、停止、刷新恢复；查看原始结果和产物。独立评估/迁移显示真实限制。
5. 选择多个有结果实验，六种图型浏览器交互；核验缺失值、单位分面及导出。
6. 关闭scheduler，队列等待；已有训练仍可停止。重新启动后不重复执行。

## 检查

根目录执行pytest、Ruff与ty；前端执行`bun run check`、`bun run typecheck`、`bun run test`、`bun run build`、`bun run test:e2e`。
真实CPU/GPU验收仍需显式`uv run pytest tests/training --run-training --run-gpu`。

## 实际证据

尚未实现；完成后记录实际命令和结果，不将此前001/002验收冒充本次证据。
