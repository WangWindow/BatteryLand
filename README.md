# BatteryLand

BatteryLand 是用于管理电池数据、创建实验并查看训练结果的平台。后端使用 FastAPI 和
SQLite，前端使用 React；训练由独立 Python 环境运行。
侧栏“数据”包含电池目录、电池详情、数据概览和多曲线对比等页面。

## 环境要求

- Linux
- Python 3.14 或更高版本、[uv](https://docs.astral.sh/uv/)
- [Bun](https://bun.sh/) 1.4 或更高版本
- 实际运行 GPU 训练时需要 NVIDIA GPU 和兼容驱动

## 克隆

使用递归克隆以同时获取 DeepPlatform 子模块：

```bash
git clone --recurse-submodules https://github.com/WangWindow/BatteryLand.git
cd BatteryLand
```

## 安装

安装后端和开发依赖：

```bash
uv python install 3.14
uv sync --python 3.14
```

安装前端依赖前，先确认 `bun --version` 为 1.4 或更高；旧版无法读取当前锁文件：

```bash
cd src/batteryland_ui
bun install --frozen-lockfile
cd ../..
```

若要运行训练任务，再安装独立的训练依赖环境（包含 PyTorch，下载时间较长）：

```bash
UV_PROJECT_ENVIRONMENT=.venv-training uv sync --python 3.14 --only-group training
```

## 数据准备

数据文件不随仓库克隆。BatteryLife 数据默认从 `/data/BatteryLife_Processed` 读取；若实际目录不同，在准备数据和启动服务前设置：

```bash
export BATTERYLAND_SOURCE_ROOTS='{"battery_life":"/绝对路径/数据目录"}'
```

首次使用电池详情、数据概览和多曲线对比前，在项目根目录建立数据层索引与核验结果：

```bash
.venv/bin/python -m batteryland.data_layer.prepare
```

准备结果默认写入 `var/data-layer/`，原始数据目录只读。首次准备可能耗时较长；以后启动服务不会重复执行。数据文件变化时重新运行准备命令，未变化的文件可复用已有索引。若设置 `BATTERYLAND_DATA_DIR` 改变运行目录，请在**准备和启动前设置为相同的值**，让两步使用同一份索引。数据层的索引口径与排错方法见[数据层技术说明](docs/integrations/batterylife-data-layer.md)。

平台原有的电池目录会在启动后自动扫描数据文件；这项扫描不会生成上述数据层索引。未配置 BatteryLife 数据时，平台的其他功能仍可启动。

## 启动

在项目根目录运行：

```bash
./scripts/run.sh
```

本机浏览器访问 <http://localhost:5173>；从其他电脑访问服务器时，将 `localhost` 换成服务器地址。后端 API 文档位于
<http://127.0.0.1:8000/docs>。按 `Ctrl+C` 可同时停止服务。只启动后端可运行
`./scripts/run.sh --services-only`。

## 运行文件

数据库、运行状态、日志和实验产物默认保存在项目的 `var/` 目录。更多启动选项可查看
`./scripts/run.sh --help`。
