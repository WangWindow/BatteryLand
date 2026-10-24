# Data Model

无数据库或文档结构迁移。

- **TrainingRuntimeIdentity**：`executable`、`prefix`、`python_version`，均为非空字符串。通过配置解释器的标准库探针取得，控制桥接必须匹配；prepare回执保存同一身份，spawn再次核对。
- **ComponentSnapshot**：源码内容指纹、完整静态组件列表。仅进程内存在，来源是固定provider和运行时上传目录；读者得到深副本。
- **状态**：训练环境不可用在validate/prepare阶段报告provider_unavailable；spawn阶段的不确定失败沿用needs_reconciliation。观察和停止不要求训练解释器可用。
