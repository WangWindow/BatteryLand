# Research: 共享环境训练联调

## 环境和依赖

- **Decision**: 单一.venv/Python3.14.7；根training组，默认dev+training；共用uv.lock。
- **Rationale**: 用户最新决定；统一约束，常规uv run/sync保留训练依赖。
- **Alternatives considered**: 第二环境、子模块pyproject已取消；直接pip安装脱离锁文件。
- **Evidence**: 源码AST的14个外部导入根；uv dependency-groups/default-groups文档。

## 解释器身份

- **Decision**: 使用sys.executable原路径，桥接报告sys.prefix并验证。
- **Rationale**: .venv/bin/python的符号链接解析后会退回基础解释器。
- **Alternatives considered**: 第二解释器和仅比较Python版本均不足以保证环境一致。

## 数据与任务

- **Decision**: MyTask后CALCE_CPMLP_seed2021单轮CPU/cuda:0，num_workers=0，保持13文件内置划分。
- **Rationale**: 文件可读无歧义、9/2/2非空；EOL>100，两个测试电池有seen标签。
- **Alternatives considered**: 自定义划分受factory缺口限制；完整100轮不适合最小联调。
- **Evidence**: 只读训练研究确认前100循环必要信号完整；原100窗口/batch16可避免过小OneCycleLR步数边界。

## 设备与边界

- **Decision**: 同一CUDA版torch执行CPU/GPU，不修改CUDA_VISIBLE_DEVICES，cuda:0由用户确认。
- **Rationale**: 驱动595.99.02可访问；受限环境NVML失败不等于宿主GPU缺失。
- **Alternatives considered**: 不替换数据、不改框架核心、不静默换设备。
- **Verification**: 精确依赖版本和任务兼容性由解析/运行验证，记录于quickstart；这不构成未决产品需求。

## 实测结论与依赖依据

共享环境可同时运行原后端、provider96项测试、真实MyTask和CALCE CPU/cuda:0。
目前没有需要第二环境解决的依赖冲突，独立进程仍保持。

首轮cu126版本选择一手依据（当前构建更新见下文）：
- [PyTorch官方cu126索引](https://download.pytorch.org/whl/cu126/torch/)：cp314 wheel与CUDA运行时来源。
- [NumPy3.14支持起点](https://numpy.org/doc/stable/release/2.3.3-notes.html)及[scipy1.16.1](https://docs.scipy.org/doc/scipy-1.16.2/release/1.16.1-notes.html)。
- [PEFT发布记录](https://github.com/huggingface/peft/releases)：0.21.2与Transformers5.18的兼容窗口。
- [uv依赖组和默认同步](https://docs.astral.sh/uv/concepts/projects/dependencies/)：单环境、统一锁定。

provider已知缺口仍保留：自定义split_dir/来源配置、结构化实际设备回报、独立评估/迁移任务。
数据工厂的空样本/EOL缺失及OneCycleLR过小步数早期校验仍应由维护者完善；不影响本轮固定CALCE样例。

## 用户确认的后续工具链更新

- 类型检查改为ty，保持src/batteryland范围，所有warning使检查失败；历史mypy证据保留。
- [官方cu130索引](https://download.pytorch.org/whl/cu130/torch/)提供2.14.1+cu130/cp314/Linux x86_64，切换构建不改变PyTorch主版本。
- [NVIDIA兼容说明](https://docs.nvidia.com/deploy/cuda-compatibility/minor-version-compatibility.html)列CUDA13.x最低驱动580，实机595.99.02满足该基线，仍以实际训练验证兼容。
- [ty配置参考](https://docs.astral.sh/ty/reference/configuration/)用于检查路径和warning退出策略，不使用全局忽略压低错误。
