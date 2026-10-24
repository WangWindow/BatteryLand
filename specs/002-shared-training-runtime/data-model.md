# Data Model: 运行环境与验收证据

不新增表，不改变实验状态机和公共DTO。

| 对象 | 字段与规则 |
| --- | --- |
| ControlRuntimeIdentity | executable/prefix/python_version均为字符串；prefix必须等于当前sys.prefix |
| PreparedExecution.runtime | 内部JSON环境身份；原intent/hash字段保持 |
| TrainingAcceptance | 实验ID、设备、输入版本、身份、退出、产物和证据；真实失败不能标成功 |

旧回执不补写新字段，原有身份核实语义保持。
effective_device继续可空，独立设备探测不能冒充训练进程实际回报。
