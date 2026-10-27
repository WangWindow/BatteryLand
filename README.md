# BatteryLand

BatteryLand 是用于管理电池数据、创建实验并查看训练结果的平台。后端使用 FastAPI 和
SQLite，前端使用 React；训练由独立 Python 环境运行。

## 环境要求

- Linux
- Python 3.14 或更高版本、[uv](https://docs.astral.sh/uv/)
- [Bun](https://bun.sh/) 1.4 或更高版本
- 实际运行 GPU 训练时需要 NVIDIA GPU 和兼容驱动

## 克隆

使用递归克隆以同时获取 DeepPlatform 子模块：

```bash
git clone --recurse-submodules https://github.com/JiaweiLab-HFUT/BatteryLand.git
cd BatteryLand
```

## 安装

安装后端和开发依赖：

```bash
uv python install 3.14
uv sync --python 3.14
```

安装前端依赖：

```bash
cd src/batteryland_ui
bun install --frozen-lockfile
cd ../..
```

若要运行训练任务，再安装独立的训练依赖环境（包含 PyTorch，下载时间较长）：

```bash
UV_PROJECT_ENVIRONMENT=.venv-training uv sync --python 3.14 --only-group training
```

## 启动

在项目根目录运行：

```bash
./scripts/run.sh
```

浏览器访问 <http://localhost:5173>；后端 API 文档位于
<http://127.0.0.1:8000/docs>。按 `Ctrl+C` 可同时停止服务。只启动后端可运行
`./scripts/run.sh --services-only`。

## 数据与运行文件

数据文件不会随仓库克隆。若 `/data/BatteryLife_Processed` 存在，后端启动后会在后台索引它。
使用其他现有数据目录时，在启动前设置：

```bash
export BATTERYLAND_SOURCE_ROOTS='{"battery_life":"/绝对路径/数据目录"}'
./scripts/run.sh
```

数据库、运行状态、日志和实验产物默认保存在项目的 `var/` 目录。更多启动选项可查看
`./scripts/run.sh --help`。
