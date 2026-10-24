# Shared Training Runtime: Validation

**Date**: 2026-10-24

## 环境与入口

```bash
uv sync
uv run batteryland serve --data-dir ./var
uv run pytest tests
```

同步默认含dev和training；服务和工作进程共用根.venv，无第二解释器设置。
固定源码与标准数据在本机可访问，GPU阶段使用正常设备权限和cuda:0。
当前类型检查为`uv run ty check`，PyTorch索引为官方cu130（CUDA13.0）。下方首轮cu126记录保留其历史事实，更新后的验证见末尾。

## 验收顺序

1. 普通测试验证相同prefix/解释器、缺包诊断、静态组件及原API。
2. 真实catalog和provider自带测试验证组件依赖。
3. MyTask成功且无虚构指标；CALCE单轮CPU/GPU产物与查询一致。
4. 长实验跨服务重启保持身份，停止后整个进程组退出。
5. Ruff、ty、构建和子模块差异检查。

## 证据

2026-10-24，Linux / CPython3.14.7 / 根.venv。后端FastAPI0.161.1、Pydantic2.14.1和PyYAML6.0.3保持。

| 验收 | 结果 |
| --- | --- |
| 共享环境契约 | 4项先失败再通过；实际bridge/prepare报告的executable、prefix与API一致 |
| 普通后端回归 | 62 passed / 4 skipped，19.28s；跳过项均为需显式开启的真实训练 |
| provider原生测试 | 同一环境96项unittest通过，18.769s；不改provider代码 |
| 实际MyTask | 1 passed，26.84s；开始/结束Hook、completed状态、无虚构指标 |
| 实际CALCE CPU | 1 passed，26.75s；900训练、200验证、200测试窗口；21项指标、2个预测及权重 |
| 实际CALCE cuda:0 | 1 passed，26.84s；21项指标、2个预测及权重；训练PID671136与物理GPU0 UUID匹配 |
| 真实HTTP重启/停止 | 1 passed，28.48s；API进程退出并重启后，训练PID671659与intent不变，停止后所属进程组退出 |
| 查询基准 | 1,001电池/23划分/100实验，100次查询p95=0.015566s，禁止文档/产物扫描断言通过 |

真实验收独立运行命令：

```bash
uv run pytest tests/training --run-training --run-gpu -q -s
```

测试数据和产物由pytest临时目录管理，不向默认var注入验收记录。
GPU日志原文为`Training started on cuda:`，只表达设备类型；验收另外核对所属训练PID与GPU0 UUID，
不能仅凭该日志或配置声称编号已证实。原始provider尚不返回结构化实际设备，API的effective_device继续为null。

首轮验收依赖锁定：torch2.14.1+cu126、numpy2.5.4、scipy1.18.1、pandas3.1.0、scikit-learn1.9.1、
matplotlib3.11.2、accelerate1.15.0、denseweight0.1.2、KDEpy1.1.12、evaluate0.4.6、peft0.21.2、
transformers5.18.0、wandb0.31.0；完整传递依赖见根uv.lock。驱动595.99.02，不修改CUDA_VISIBLE_DEVICES。

## 联调发现与处理

- 初始全量内置导入遇到非CALCE的MICH同名文件歧义，因此验收仅登记CALCE原始13引用；不放松歧义检查或改变划分。
- CPU训练实际成功后发现宿主采集未把冻结快照的provider_commit传入组件登记。已增加小型失败回归，
  在结果应用服务按权威快照补齐提交身份；CPU/GPU完整采集重新验收通过，不改写冻结原文。
- 初次独立CUDA探针把2×2全1矩阵乘积的元素和误断言为16（正确为8），因此误报失败；
  CUDA初始化与计算本身正常，后续已纠正断言并完成真实GPU训练。没有重编号、CPU回退或引入第二环境。

## 是否需要第二套解释器

当前无需第二套虚拟环境：所有依赖可解析/导入，真实CPU/GPU闭环与原后端测试共存。
保留独立训练进程以隔离全局注册表、日志、CUDA上下文和停止生命周期；这不要求第二套环境。
training依赖组只组织依赖，不隔离版本。后续如出现不可调和的核心依赖或Python版本约束，
或API/训练需独立部署与升级，再以新规格评估环境拆分。

## 当前工具链更新验收 — ty / CUDA13

2026-10-24，依赖已切换为torch2.14.1+cu130，torch.version.cuda为13.0，ty0.0.91。
共享根.venv和Python3.14.7保持；mypy及其专属依赖已从开发依赖和锁文件移除。

| 检查 | 当前结果 |
| --- | --- |
| `uv run ty check` | 通过，src/batteryland，warning也使退出失败；无新增忽略规则 |
| Ruff检查与格式 | 通过，87个文件格式一致 |
| 普通后端回归 | 62 passed / 4 skipped，19.96s；真实训练仍显式开启 |
| provider原生测试 | 96项通过，22.009s |
| CUDA13真实验收 | 4 passed，121.26s；MyTask、CALCE CPU、CALCE cuda:0、真实HTTP重启/停止 |
| GPU身份 | 训练PID678849对应GPU0 UUID GPU-97718414-11ff-d5e7-b03e-d77dcb2bbc0f |
| 重启身份 | 训练PID679055及intent在API进程重启后保持，最终所属进程组退出 |
| 构建与源码 | sdist/wheel构建及git diff --check通过；deeplatform未修改 |

CUDA13的CALCE CPU和GPU实验均采集21项指标、2个电池预测及模型权重，来源下载和图表查询通过。
类型迁移仅修正内部仓储命名遮蔽、预测列表标注与上下文生成器注解；HTTP接口和数据库结构保持。
