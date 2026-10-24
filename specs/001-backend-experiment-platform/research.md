# Research: 后端存储、执行与能力接入

**Date**: 2026-10-23
**Scope**: 只读源码调研与官方资料核对；未安装依赖、执行训练或测量性能。

## 1. 同步 ORM 与短事务

**Decision**: SQLAlchemy 2.x 同步 ORM + Alembic；一个同步用例拥有一个 Session，线程内创建和关闭。
Python >=3.14 显式设置 SQLite `autocommit=False`，每连接启用外键；开启外键时按官方示例在事务外执行。
文件库采用 WAL、5s busy timeout；WAL 在无活动事务的数据库初始化连接中配置。持续锁冲突报存储繁忙而非重跑整个业务。

**Rationale**: 无需异步驱动或额外服务。SQLite 仍是单写事务，保持事务短小；
`check_same_thread=False` 不会让 Session 变为线程安全。完整同步用例提交到工作线程，不能传递 Session 给采集器。

**Alternatives considered**: AsyncSession 增加驱动和生命周期成本；全局 Session 不符合并发模型；
SQLModel 将输入模型与持久化合并不利于已经确认的对象边界。

**Sources**:
[SQLAlchemy Session](https://docs.sqlalchemy.org/en/20/orm/session_basics.html)、
[SQLite dialect](https://docs.sqlalchemy.org/en/20/dialects/sqlite.html)、
[SQLite isolation](https://sqlite.org/isolation.html)、
[外键](https://www.sqlite.org/foreignkeys.html)、
[Alembic batch](https://alembic.sqlalchemy.org/en/latest/batch.html)。

## 2. JSON 不可变文档与查询投影

**Decision**: 发布带哈希的新文档版本，再用单个 SQLite 事务提交业务引用及可重建投影。
发布采用同目录临时文件、flush/fsync、原子发布和父目录同步；已有版本不可被覆盖。
未提交引用的新版本保留为可清理孤儿，不立即删除仍可能被另一次成功操作引用的内容。

**Rationale**: 失败时保留旧查询视图，避免跨存储事务协议。发布与 SQLite 提交前均验证内容哈希；
查询遇到外部损坏时明确报错，恢复工具依据已提交引用检查，不能假设外部删除能被事务防止。

**Alternatives considered**: 原地覆盖会改变历史实验；MongoDB/JSON 长期双写增加不一致；
每次检索扫描文档不能满足既定查询路径。首版不为未知超参数建立动态索引。

**Sources**: [Python 文件操作与 fsync](https://docs.python.org/3/library/os.html)、
[SQLite query planner](https://sqlite.org/queryplanner.html)。

## 3. 训练解释器隔离与桥接

**Decision**: 后端提供薄桥接，由独立训练解释器运行，复用 provider 的 parse/check、catalog、upload、prepare；
真实执行由后端直接 Popen 现有 main.py --experiment-dir，取得自己创建的进程身份。

**Rationale**: Frame 导入即依赖 torch，发现目录会导入全部组件；训练日志接管进程全局标准流和日志。
结构化 JSON stdout 与诊断 stderr 分开，不解析人类可读启动输出。主项目依赖不包含训练科学计算栈。

**Alternatives considered**: 在 API 线程直接运行 Frame 会产生全局状态与环境耦合；新建训练 HTTP 服务超出首版环境要求。

**Evidence**: ../../src/deeplatform/frame/frame.py:20、:54、:102；
../../src/deeplatform/main.py:11、:35；../../src/deeplatform/core/experiment/logging.py:31；
../../src/deeplatform/tools/component_catalog.py:13。

## 4. 串行启动与恢复

**Decision**: 队列和业务状态持久化在 SQLite；一个 backend 进程协调，条件认领 queued → starting。
运行根目录持有进程级独占锁，第二个协调实例启动失败；Uvicorn 使用单 worker。
启动结果不确定标 needs_reconciliation，不自动重启该实验，先核实再继续队列。

**Rationale**: provider 的 run_prepared 仅检查 status.json 存在，不构成并发锁。
进程创建不能与 SQLite 事务原子提交，需保存启动意图、目录回执及可核实身份，避免重复执行。

**Alternatives considered**: Redis/Celery 增加基础设施；仅内存队列丢失恢复信息；仅记录 PID 会因复用误终止其他进程。

**Evidence**: ../../src/deeplatform/frame/frame.py:43；../../src/deeplatform/core/experiment/logging.py:35。

## 5. 组件独立目录与查重

**Decision**: 上传使用 provider 的 project_root 参数安装到运行根，训练进程把运行根及 provider 根加入命名空间搜索路径。
桥接在一个写锁内合并两个根的静态注册声明做前置查重，再调用原上传工具；每次实验用新进程发现组件。

**Rationale**: provider 不需修改；上传不执行源码。单独 runtime 根的 ComponentStore 只扫描自己，
必须补齐跨根重名判断，而不是等自动发现阶段才失败。

**Alternatives considered**: 写入子模块目录混合源码与用户资源；API 进程常驻全局注册表无法可靠刷新上传组件。

**Evidence**: ../../src/deeplatform/tools/component_upload.py:107、:118、:210；
../../src/deeplatform/tests/test_component_catalog.py:221。

## 6. 查询、结果与图表

**Decision**: 常用字段、成员和指标形成与来源版本绑定的查询投影。
采集只消费完整 JSONL 行，指标去重及游标推进同事务；最终结果按内容哈希导入。
基本图表输出 ChartSpec，类型限指标柱图、轮次折线和真值预测散点。

**Rationale**: 同一实验的窗口级指标与逐电池平均预测不能互相替换。
当前 MAPE 为原始比率，Accuracy 为 0–100 百分数，不能统一再乘 100。
缺失值和未知单位显式保留，不生成任意脚本或假数据。

**Alternatives considered**: 查询时全目录扫描、把日志解析当指标、按电池均值重算官方指标、返回动态执行代码均不采用。

**Evidence**: ../../src/deeplatform/task/batteryLife_run.py:108、:115、:129；
../../src/deeplatform/components/metric/mape.py:6；../../src/deeplatform/components/metric/accuracy.py:10。

## 7. Provider 兼容与反馈清单

| 项目 | 静态事实 | 决策与验证责任 |
| --- | --- | --- |
| 自定义划分 | Loader 有 split_dir，factory 未传入 | provider 维护者补可配置入口；此前拒绝不同于内置内容的真实执行 |
| 原始数据位置 | factory 固定 /data/BatteryLife_Processed | 维护者暴露来源配置；不修改源码或伪装数据位置 |
| 精确 GPU 编号 | Accelerator 工厂只按 device.type 判断 cpu | 保留原请求；真实环境验证由 provider 联调负责 |
| 实际设备 | status.json 的 device 直接复制配置值 | requested_device 与 effective_device 分离，后者未证实为空 |
| 共享辅助文件 | factory 会写合并标签及软链接 | 首版串行；并行前需维护者提供隔离/只读数据准备边界 |
| 独立评估/迁移 | 当前仅 BatteryLifeRun 和 MyTask | 标明任务未就绪，不因存在 validate 或 PEFT import 宣称具备能力 |
| 依赖环境 | 未见独立依赖/打包清单，README 使用 Conda 环境 | 配置训练解释器并保存环境标识；不推测与主项目 Python 已兼容 |

以上是已识别并已确定处理方式的外部依赖，不是未决设计问题。
反馈以文档条目交付；本阶段未向其他贡献者发送外部消息。
