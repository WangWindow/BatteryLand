# BatteryLand

电池实验平台后端：管理标准电池资源、划分、配置与实验，通过独立进程接入 deeplatform，提供结果查询和浏览器图表所需的数据。

后端使用 Python 3.14、FastAPI、SQLAlchemy/Alembic 和 SQLite；完整配置、划分和结果保存为不可变 JSON 文档。无需 Redis 或 MongoDB。前端独立开发，使用 React、shadcn/ui 与 Tailwind CSS。

```bash
uv sync
uv run batteryland init --data-dir ./var
uv run batteryland serve --data-dir ./var --host 127.0.0.1 --port 8000
```

接口文档：<http://127.0.0.1:8000/docs>。默认单 worker，同一运行目录只能由一个后端实例协调。

来源目录通过环境变量登记，API 只接收别名及相对文件引用：

```bash
export BATTERYLAND_SOURCE_ROOTS='{"battery-life":"/data/BatteryLife_Processed"}'
```

在启动服务前设置该变量，再通过 `POST /api/v1/data-sources` 创建来源，提交 `name` 和 `root_alias`。清单通过来源的 `/import` 接口导入。停服后，`batteryland import-bundled --source-id UUID --data-dir ./var` 可幂等登记内置的 1,001 条电池引用、23 份划分和示例模板。

API 与训练共用根目录 `.venv`，`uv sync` 默认安装 `dev` 和 `training` 依赖组，并使用同一份 `uv.lock`。训练在独立子进程中使用当前 `sys.executable`，无需配置第二个解释器。训练依赖缺失时，资源管理和静态组件操作仍可使用，动态参数描述与执行会说明缺失原因。源码检出之外的安装需设置 `BATTERYLAND_PROVIDER_ROOT`。

PyTorch 使用官方 CUDA 13.0（`cu130`）构建。主项目类型检查使用 ty，检查范围为 `src/batteryland`，警告也会导致检查失败。

普通回归不执行真实训练。真实 CPU/GPU 验收分别显式启用：

```bash
uv run pytest tests/training --run-training
uv run pytest tests/training --run-training --run-gpu
```

当前调度为持久化 FIFO 串行执行，支持停止；设备必须显式为 `cpu` 或 `cuda:N`。一次实验只执行一次，重跑须复制。身份不确定的执行暂停派发；停服后使用 `batteryland reconcile --experiment-id UUID --data-dir ./var` 核对已保存回执，不会重新启动训练。

deeplatform 固定原始数据路径、自定义划分入口及精确 CUDA 编号存在对接条件，详见[接入契约](specs/001-backend-experiment-platform/contracts/capabilities.md)。这些条件未满足时会拒绝执行。主项目不修改训练子模块。

```bash
uv run pytest tests
uv run ruff check src/batteryland tests
uv run ruff format --check src/batteryland tests
uv run ty check
uv build
```

[开发规范](.specify/memory/constitution.md) · [首版规格](specs/001-backend-experiment-platform/spec.md) · [共享环境训练联调](specs/002-shared-training-runtime/quickstart.md) · [HTTP 契约](specs/001-backend-experiment-platform/contracts/http-api.md)
