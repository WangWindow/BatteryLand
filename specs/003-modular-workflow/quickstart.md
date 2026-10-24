# Quickstart: 模块化实验工作台

## 启动

在仓库根运行`uv sync`和`uv run batteryland init --data-dir ./var`。
配置允许来源后启动`uv run batteryland serve --data-dir ./var`，另开终端执行`uv run python -m simple_impl.scheduler`。
前端在`src/simple_impl/ui`运行`bun install --frozen-lockfile`与`bun run dev`，打开http://127.0.0.1:5173。
界面右上/侧栏可切换简体中文与English，选择保存在浏览器本地。
前端开发和preview通过代理访问后端；生产部署将/api代理到独立后端，不把页面嵌入引擎。

## 验收

1. 来源登记、清单导入、筛选，创建/修改/导出/导入划分。
2. 模板导入/编辑，组件预览/上传、权重登记与下载。
3. 从模板创建实验，校验并入队；独立scheduler驱动执行。默认MyTask可进行真实CPU最小闭环，CALCE使用既有原生划分。
4. 观察日志、停止、刷新恢复；查看原始结果和产物。独立评估/迁移显示真实限制。
5. 选择多个有结果实验，六种图型浏览器交互；核验缺失值、单位分面及导出。
6. 关闭scheduler，队列等待；已有训练仍可停止。重新启动后不重复执行。

## 检查

根目录执行pytest、Ruff与ty；前端执行`bun run check`（Biome + 国际化检查）、`bun run typecheck`、`bun run test`、`bun run build`、`bun run test:e2e`或`bun run verify`。
新增或修改任何界面文案时必须同时更新`src/i18n/messages/`中的中英文；只改一种语言或硬编码文本会使检查失败。
真实CPU/GPU验收仍需显式`uv run pytest tests/training --run-training --run-gpu`。

## 实际证据

2026-10-24 本轮实测：

- 后端：`uv run pytest` → 76 passed / 4 skipped；`ruff check`、`ruff format --check`、`ty check` 通过；当前OpenAPI 49个操作。
- 前端：`bun run typecheck`、`bun run check`（Biome + 国际化）通过，624个中英词典键一致；`bun run test` → 20 passed；`bun run build` 成功，visualizer与Recharts在独立chunk。
- 浏览器：`bun run test:e2e` → 4 passed。真实HTTP引擎、独立scheduler与Chromium完成来源/清单/划分/模板/实验/执行/日志/结果/六种图型/停止/语言切换/窄屏与键盘验收；懒加载失败显示可恢复错误。
- 真实训练：`uv run pytest tests/training --run-training --run-gpu` → 4 passed（119.28s），覆盖MyTask、CALCE CPU、CALCE cuda:0（RTX 4090）、真实HTTP重启/停止；均经独立scheduler派发。
- 真实浏览器MyTask：`bash tests/run_e2e_real.sh` → 1 passed（26.0s），浏览器经真实后端、deeplatform provider与独立scheduler执行；结果按真实语义显示为不可用（MyTask不产生最终结果）。
