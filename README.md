# BatteryLand

电池实验与结果分析平台。后端使用FastAPI、SQLAlchemy和SQLite，配置与结果保存为JSON文档；训练由deeplatform执行。前端使用React、shadcn/ui和Tailwind CSS，支持中文与英文。

## 安装

需要Python3.14、uv、Bun1.4+及Linux。

```bash
uv sync --locked
UV_PROJECT_ENVIRONMENT=.venv-training uv sync --locked --only-group training --compile-bytecode
uv run batteryland init --data-dir ./var
cd src/batteryland_ui
bun install --frozen-lockfile
```

后端默认安装不含训练库；训练环境只安装training依赖组，不安装后端。两者由根项目统一管理。
可通过`BATTERYLAND_TRAINING_PYTHON=/absolute/path/bin/python`指定训练环境，保留虚拟环境入口路径。
训练调试直接使用`.venv-training/bin/python`；对训练环境执行普通`uv run`可能自动改变其依赖集合。

## 启动

在仓库根启动后端，调度器随服务运行：

```bash
# 使用真实数据时配置允许的来源别名
export BATTERYLAND_SOURCE_ROOTS='{"battery-life":"/data/BatteryLife_Processed"}'
uv run batteryland serve --data-dir ./var --host 127.0.0.1 --port 8000
```

在另一个终端启动前端：

```bash
cd src/batteryland_ui
bun run dev
```

打开<http://127.0.0.1:5173>；API文档位于<http://127.0.0.1:8000/docs>。自定义后端端口时通过`VITE_PROXY_TARGET`配置前端代理。

## 使用

1. 登记数据来源并导入电池清单，选择电池创建划分。
2. 导入或创建模板，选择模板、划分与运行参数创建实验。
3. 校验后提交到队列，后端自动串行执行。实验详情可查看日志、结果和下载产物。
4. 在结果比较页选择实验或电池集合，查看浏览器交互图表并导出数据。

配置与划分都有版本，已入队的输入保持冻结；重跑通过复制实验创建新草稿。设备使用明确的`cpu`或`cuda:N`。
真实电池训练目前使用provider可读取的原生划分；自定义划分执行、独立评估和迁移仍受接入能力限制。
同一数据目录只运行一个后端实例。执行身份需要核实时，停服后使用`batteryland reconcile --experiment-id UUID --data-dir ./var`。

## 检查

```bash
uv run pytest tests
uv run ruff check src/batteryland tests
uv run ty check
cd src/batteryland_ui
bun run verify
bun run test:e2e
```

真实训练显式运行`uv run pytest tests/training --run-training --run-gpu`；真实浏览器MyTask运行`bash tests/run_e2e_real.sh`。

[当前运行时规格](specs/005-isolated-training-runtime/spec.md) · [工作台规格](specs/004-integrated-workbench/spec.md) · [环境安装与验收](specs/005-isolated-training-runtime/quickstart.md) · [工作台使用](specs/004-integrated-workbench/quickstart.md) · [开发规范](.specify/memory/constitution.md)
