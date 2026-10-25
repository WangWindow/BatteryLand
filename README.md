# BatteryLand

电池数据与实验平台。前端使用 React、shadcn/ui 和 Tailwind CSS；后端使用 FastAPI、
SQLAlchemy 和 SQLite。后端内部调度任务，DeepPlatform 在独立 Python 环境中执行训练。

## 安装

需要 Python 3.14、uv、Bun 1.4+ 和 Linux。GPU 训练还需要可用的 NVIDIA 驱动。

```bash
uv sync --locked
UV_PROJECT_ENVIRONMENT=.venv-training uv sync --locked --only-group training --compile-bytecode
cd src/batteryland_ui && bun install --frozen-lockfile
```

API 环境不安装 PyTorch；训练依赖由根项目的 `training` 组统一管理。可通过
`BATTERYLAND_TRAINING_PYTHON` 指定训练解释器。

## 启动

```bash
./scripts/run.sh
```

开发时前端监听 `0.0.0.0:5173`，FastAPI 监听 `127.0.0.1:8000`；前端的 API 请求
代理到 FastAPI。调度器和训练适配器不额外占用 HTTP 端口。只启动后端可使用
`./scripts/run.sh --services-only`。脚本按自身位置解析项目路径，`Ctrl+C` 停止进程。

如果 `/data/BatteryLife_Processed` 存在，后端自动建立固定文件目录索引；
`BATTERYLAND_SOURCE_ROOTS` 可覆盖数据根目录映射。真实数据文件不复制进数据库。
使用 `BATTERYLAND_DATA_DIR` 设置运行目录。更多选项见 `./scripts/run.sh --help`。

## 实验数据流

1. 客户端准备完整配置 YAML 与划分 JSON，调用 `POST /api/v1/training/validation`。
2. 使用校验收据调用 `POST /api/v1/validated-experiments` 保存草稿，可在提交前更新。
3. 调用 `POST /api/v1/validated-experiments/{id}/submit` 冻结输入并排队。
4. 内部调度器在 GPU 可用时解析 `auto`，或保留明确指定的 `cuda:N`，并只启动一次训练。
5. 通过实验 ID 查询状态、日志、指标、结果和产物；运行中可调用实验停止接口。

每个实验 ID 只能执行一次。相同配置的再次训练应创建新实验。自定义划分可校验和保存，
但当前 DeepPlatform 只能执行其内置划分；不能执行的收据会声明这一限制并阻止提交。
内置划分中的重名文件也会标记为歧义，不作为可执行输入。独立评估与迁移训练尚待提供者支持。

API 文档位于 <http://127.0.0.1:8000/docs>；资源快照见
`GET /api/v1/scheduler/resources`。前端当前仍在按已稳定的 API 契约调整，
本阶段以 API 与训练流程验证为准。

## 后端目录

`src/batteryland/` 以功能为一级目录，进入目录即可找到该功能的路由、用例和存储实现：

| 目录 | 职责 |
| --- | --- |
| `datasets/` | 固定电池目录、命名集合、划分与统计 |
| `experiments/` | 实验草稿、校验输入、模板和状态 |
| `training/` | DeepPlatform 校验、适配和训练子进程 |
| `scheduler/` | FIFO、资源采样、停止和执行记录 |
| `results/`、`analytics/` | 指标、产物、比较与图表数据 |
| `components/` | 组件目录、上传和权重 |
| `api/`、`db/`、`documents/`、`common/` | 共享 HTTP 入口、SQLite、文档和通用工具 |

功能包按需使用 `routes.py`、`service.py`、`repository.py`、`rules.py` 等文件名。
详细边界见[后端目录说明](docs/architecture/backend-layout.md)。

## 检查

```bash
.venv/bin/pytest tests/unit tests/contract tests/integration
.venv/bin/ruff check src/batteryland tests
.venv/bin/ruff format --check src/batteryland tests
.venv/bin/ty check src/batteryland
```

真实 GPU 接入测试显式执行
`.venv/bin/pytest tests/training/test_real_service_flow.py --run-training --run-gpu`。
自定义划分的 DeepPlatform CPU 接受测试执行
`.venv/bin/pytest tests/training/test_custom_split_runtime.py --run-training`。

[当前规格](specs/012-backend-service-protocol/spec.md) ·
[API 调用示例](specs/012-backend-service-protocol/quickstart.md) ·
[DeepPlatform 接口请求](docs/integrations/deeplatform-custom-split.md) ·
[开发规范](.specify/memory/constitution.md)
