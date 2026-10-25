# 后端模块布局

后端按功能组织一级目录，目录名对应可独立理解的业务能力。各功能包按需要放置
`routes.py`（HTTP）、`service.py`（用例）、`repository.py`（SQLite 访问）、
`rules.py`（纯业务规则）或更准确的名称；不为了形式创建每一层。

```text
src/batteryland/
  api/          FastAPI 应用与统一响应
  datasets/     固定电池池、命名集合、划分及统计
  experiments/  已校验输入、实验状态和执行记录
  training/     DeepPlatform 适配、配置校验、子进程与回执
  scheduler/    FIFO、GPU/CPU/内存采样、认领与停止
  results/      指标、日志、产物和结果查询
  analytics/    数据集与实验比较、图表数据
  components/   组件与权重目录
  documents/    SQLite JSON 文档版本存取
  db/           SQLAlchemy 模型、事务、迁移和共享仓储契约
  common/       跨功能的错误、解析与受控文件操作
  container.py  运行时依赖装配
  config.py     环境配置
  main.py       CLI 与单服务启动入口
```

FastAPI 路由调用用例服务；用例经仓储访问 SQLite 或经 `training/` 适配器调用
DeepPlatform。`db/models.py` 只定义 ORM 映射，不作为 API DTO。调度器属于后端进程，
真正训练由独立训练解释器执行。前端只调用公开 HTTP API。

训练配置与划分只通过 provider 校验后的 `validated-experiments` 流程保存和排队。
调度器状态、队列和资源分别由 `/scheduler/status`、`/scheduler/queue` 与
`/scheduler/resources` 提供。内部认领和进程事件由本地调度器直接调用服务，不暴露
worker HTTP 协议。固定数据源只提供浏览接口，逻辑数据集划分由 `/splits` 管理。
