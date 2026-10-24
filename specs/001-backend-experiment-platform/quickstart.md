# Quickstart and Validation Guide

后续环境策略见[共享环境训练联调](../002-shared-training-runtime/quickstart.md)：当前统一根.venv，
不再配置BATTERYLAND_TRAINING_PYTHON。下方2026-10-24首版验证记录保留其当时状态。

**Date**: 2026-10-24
**Spec**: [spec.md](spec.md)
**Contracts**: [HTTP](contracts/http-api.md)、[能力接口](contracts/capabilities.md)

## 阶段与前提

首版后端已实施。本指南列出运行方式与已执行的验收；真实训练环境的验证单独记录。

- Linux、uv、主项目 Python >=3.14、本地可写数据目录。
- 训练测试与普通后端测试分开；普通测试不依赖 torch/GPU、真实电池文件或其他服务。
- 真实接入需单独配置训练解释器、固定 provider 提交、可访问的标准数据及 provider 依赖。
- 默认可信本机/内网，不增加账号系统；服务单 worker，不能同时启动多个协调实例。

## 启动约定

使用以下命令，init 建立目录并运行 Alembic upgrade：

```bash
uv sync --group dev
uv run batteryland init --data-dir ./var
uv run batteryland serve --data-dir ./var --host 127.0.0.1 --port 8000
```

默认运行目录为 var，命令行 data-dir 优先于 BATTERYLAND_DATA_DIR。
允许来源通过 BATTERYLAND_SOURCE_ROOTS JSON 对象配置（别名映射绝对目录），
API 只接受别名及相对引用。真实训练另设 BATTERYLAND_TRAINING_PYTHON 和可选 BATTERYLAND_PROVIDER_ROOT；
缺失时资源管理和基础分析仍可运行，训练能力明确 unavailable。

```bash
curl http://127.0.0.1:8000/api/v1/capabilities
curl http://127.0.0.1:8000/api/v1/experiments
```

capabilities 报告基础模块版本和训练限制；空实验列表为成功响应 items=[]、total=0。
开发 API 文档入口 /docs，机器契约 /openapi.json；实现与 contracts/openapi.json 同步。

## 场景 A：持久化、资源与划分

1. 使用临时允许来源，登记 3 个电池清单，再导入一次：第二次 existing=3，数量不增加。
2. 使用另一个来源的同名电池：新 ID，不合并身份。
3. 创建手动划分，验证成员查询、版本和 provider 四字段导出；重叠分组返回明确错误。
4. 固定种子生成 random/hybrid 划分两次，成员完全相同，手动固定项不移动。
5. 发布新文档后模拟 SQL 回滚，原引用与索引仍有效；模拟文件发布失败时没有新提交引用。
6. 导入内置划分及示例模板可用 `batteryland import-bundled --source-id UUID`，
   只登记清单引用及模板，明确报告原始数据是否可访问，不启动训练。

**对应**：US1/US2，FR-001–FR-008、FR-031–FR-032，SC-001–SC-003。

## 场景 B：配置、快照与查询

1. 从模板创建草稿，修改并读取完整配置；以过期 expected_revision 更新返回冲突。
2. 校验缺失引用、auto、未知任务、组件参数错误；校验不创建实验目录或进程。
3. 用已就绪的受控执行能力提交草稿；再修改模板及划分，旧实验仍引用原版本。
4. 使用 GET /experiments 的模型、任务、状态、设备、时间和源目标域过滤；
   通过 SQL 查询与读取计数确认列表不会打开每个配置文档。

**对应**：US3，FR-009–FR-013、FR-025–FR-026、FR-032–FR-034，SC-005。

## 场景 C：串行、重复提交、终止和恢复

1. 使用测试注入的短进程执行能力提交 A/B/C，记录开始结束顺序及最大活动数=1。
2. 对 A 重复提交十次，执行回执与启动次数仍为一个；完成后重新提交拒绝，复制后新实验可执行。
3. 排队 B 停止后不被启动；运行 A 停止先 stopping，确认进程组退出才 stopped。
4. 模拟自然完成与停止竞态，已完成结果不被改写为人工停止。
5. 模拟 spawn 后回执丢失及服务重启：待核实且不重复启动，未知活动执行阻止新增派发。
6. 另起第二协调实例，必须拒绝取得同一运行根；进程身份不匹配时不得向其发信号。

测试替身只允许测试工厂注入，不能通过 HTTP 参数或生产环境变量启用。

**对应**：US4，FR-012–FR-019，SC-004–SC-006。

## 场景 D：目录、上传和真实训练接口

1. 查询组件参数，保留 required/default/injected/configurable；目录扫描不创建组件实例。
2. 上传合法测试组件，检查安装未执行源码，新解释器可发现；上传与内置类型同名的组件被拒绝。
3. 在独立训练环境使用 provider MyTask 完成最小真实进程冒烟，检查唯一目录和日志/状态。
4. 真实 BatteryLifeRun 仅在内置划分内容一致、数据可读且设备验证通过时执行；
   自定义划分目录、固定来源和精确 GPU 编号未闭合时明确记录缺口，不改子模块。
5. 权重上传登记和下载保留校验值，不反序列化文件；登记不冒充已实现权重加载。

**对应**：US5，FR-020–FR-022、FR-025、FR-033–FR-034。

## 场景 E：采集、比较和图表

1. metrics.jsonl 先写半行，再补完整行；首次不推进未完成位置，补齐后只导入一次。
2. 同内容 best_result 重复导入不增版本；替换或截断文件时游标有明确失效或重建行为。
3. 查询窗口级指标与电池级均值预测：单位、粒度和聚合说明保留。
4. 两个实验分别含 MAPE/ABC 和 MAE，电池名单不同且部分 target=null：比较保留并集和 null。
5. 生成指标柱图、轮次折线、真值预测散点与集合基础图；无真值、不支持类型明确报错。
6. 比较导出 JSON/CSV 保留自定义字段和缺失语义；未知单位按实验隔离。
7. 日志游标与 SSE 断线重连不跳过内容；终态读尽后发 end，替换文件返回 cursor_invalid。

**对应**：US6/US7，FR-023–FR-030，SC-007–SC-008。

## 检查命令与性能基准

实施时每个行为先有预期失败测试，再最小实现、回归和重构。以下目录和命令由 tasks.md 落实：

```bash
uv run pytest tests/unit tests/integration tests/contract
uv run ruff format --check src/batteryland tests
uv run ruff check src/batteryland tests
uv run ty check
uv build
```

基准使用临时数据：现有 23 个划分、1,001 个电池引用、100 个实验；
在同一进程、本地磁盘与单客户端下先预热，再对固定筛选/分页执行 100 次并报告 p95。
目标 <=2s，同时检查查询不扫描全量文档；不能将该小规模结果外推为 GPU 或多用户性能结论。

## 证据记录

| 检查 | 当前状态 |
| --- | --- |
| 业务测试、迁移与失败边界 | 57 项 pytest 验证，涵盖七个故事、不可变文档并发、事务回滚、进程组和恢复 |
| API 与机器契约 | 37 条路径、48 个操作；运行时 OpenAPI 与保存契约一致，引用与错误 schema 检查通过 |
| 静态与构建 | Ruff、严格 mypy、sdist/wheel 构建通过；隔离 wheel 可运行所打包的 Alembic 迁移 |
| 真实 HTTP | 临时 localhost 服务完成来源导入、草稿、组件预览、503/501、OpenAPI、重启持久化冒烟 |
| 固定 provider 的非训练契约 | 实际静态目录/上传及参数描述函数通过；描述不构造组件，未导入 torch |
| 完整训练 / CUDA | 未运行；未配置带科学依赖的训练解释器，API 环境没有 torch；原始数据根存在不代表全部执行条件满足 |
| 性能目标 | 1,001 电池 / 23 划分 / 100 实验，100 次常用查询 p95=0.018041s；禁止文档/产物扫描的保护断言通过 |

外部缺口的处理方式已明确在 research.md；不因测试替身通过而更新为真实训练成功。

验证环境为 Linux、Python 3.14.7；锁定依赖见 uv.lock。Starlette 对测试用 HTTPX 给出一条弃用提示，测试均通过。
ASGI 集成测试需要正常的本机线程唤醒与子进程权限；本次在允许这些能力的环境执行。
查询基准仅说明该固定样例的单用户本地表现，不外推为多用户、GPU 或大规模训练性能。

本机维护需先停服以取得运行目录锁。`reconcile` 只恢复输入意图、清单与配置哈希一致的回执，
再核验真实进程身份/终态证据；证据缺失时继续保留 needs_reconciliation，不提供任意设置状态的开关。
结果导入上限为单个 JSON 16 MiB、单条 JSONL 4 MiB；错误会保留旧结果并显示 collection.error。
最终结果按哈希归档，原始文件变化不会覆盖已有来源证据。
