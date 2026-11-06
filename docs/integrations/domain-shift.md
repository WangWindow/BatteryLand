# 电池域差异分析集成

BatteryLand 已将原 Streamlit 页面改造为原生 React + FastAPI 功能。计算代码位于
`src/batteryland/domain_shift/`，页面位于
`src/batteryland_ui/src/pages/domain-shift.tsx`。

## 功能入口

启动平台后，在左侧“分析”分组点击“电池域差异分析”，或直接访问：

```text
/analysis/domain-shift
```

页面直接使用“电池目录”中已经索引的物理数据集。API 只接受数据集 ID，文件路径由后端根据
`BATTERYLAND_SOURCE_ROOTS` 解析，前端不能提交任意服务器路径。

## 模型特征

选择“模型特征”后，默认使用“直接选择模型”：选择 BatteryLife 模型，确认模型参数和初始化种子，
选择源域、目标域数据，点击提取特征。此流程不创建实验、不执行训练，也不要求已有权重文件。
源域和目标域在同一模型实例中推理，结果标明“随机初始化”和初始化种子。

“加载实验权重”保留原有入口，可以选择成功完成实验的完整权重来查看训练后模型的表示。
两种方式都使用模型原生 `embedding`，目前仅支持曲线、掩码和 `return_embedding` 接口。

模型目录来自 `BATTERYLAND_BATTERYLIFE_ROOT/models/`，需要将该环境变量设置为 BatteryLife 源码根目录；
推理使用 `BATTERYLAND_TRAINING_PYTHON` 指定的环境。模型参数从 `run*.py`（包括 `run_main.py`）
和 `main.py` 的字面量默认值读取，CPMLP 同时提供与平台配置编辑器一致的默认参数。
没有默认值的必需参数会在页面中提示，不能以 `null` 提交；维度参数必须是整数。
窗口长度、早期循环数、曲线重采样长度也可以调整。

模型特征缓存位于 `${BATTERYLAND_DATA_DIR}/domain-shift/model-features/`，按模型源码、参数、
权重摘要或初始化种子、数据版本和采样步长分别保存。

## 缓存与任务

首次分析会将每个可信 `.pkl` 电池文件提取为循环级特征，缓存到：

```text
${BATTERYLAND_DATA_DIR}/domain-shift/features/
```

特征提取通过后台任务执行。任务状态保存在进程内；服务重启后任务状态会清空，但已完成的逐文件
缓存会保留，再次提交时会从缺失文件继续。

## API

- `GET /api/v1/domain-shift/architectures`：列出模型结构及默认参数，不依赖实验记录。
- `GET /api/v1/domain-shift/models`：列出已完成实验及可用权重。
- `POST /api/v1/domain-shift/cache/status`：查询特征缓存状态。
- `POST /api/v1/domain-shift/jobs`：创建特征提取任务。
- `GET /api/v1/domain-shift/jobs/{job_id}`：查询任务进度。
- `POST /api/v1/domain-shift/analysis`：计算概览、PCA、整体差异和数据集两两差异。
- `POST /api/v1/domain-shift/distribution`：计算单特征直方分布及描述统计。

完整字段定义见 `/docs` 或
`specs/012-backend-service-protocol/contracts/core-openapi.json`。

## 更新依赖与启动

后端新增 NumPy、Pandas、SciPy、scikit-learn 和 joblib 运行依赖。部署代码后执行：

```bash
uv sync --locked
cd src/batteryland_ui
bun install --frozen-lockfile
cd ../..
bash scripts/run.sh
```

本次前端没有新增 npm/bun 包，但仍建议按锁文件确认依赖完整。

## 验证

```bash
uv run pytest tests/contract/test_api.py tests/test_domain_shift.py -q
uv run ruff check src/batteryland
uv run ty check src/batteryland

cd src/batteryland_ui
bun run typecheck
bun run test
bun run build
```

特征定义继承原 `battery-domain-shift` 实现：电流正负区分充放电阶段，按额定容量生成 C-rate
和容量比例特征，并提供归一化 Wasserstein 距离、标准化均值差及 PCA 投影。
