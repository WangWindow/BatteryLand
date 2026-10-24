# Data Model: 模块化工作台

## DispatchRequest

- experiment_id：既有实验UUID。
- expected_revision：正整数；只在queued首次认领时核对。
- policy_id：1..100字符，默认fifo；仅用于派发诊断，不授权、改设备或改变状态规则。

无新持久化实体。既有Execution.intent_id和冻结输入保持唯一执行来源。
queued→starting仍为条件更新，事务提交后才prepare/spawn；其他活动状态阻止新认领。
重复派发已认领/终态实验只返回既有状态；draft拒绝；待核实阻断。

## Frontend State

服务器DTO由OpenAPI生成，不重新定义持久化模型。查询条件、页码、选择和编辑草稿为浏览器临时状态，保存时提交expected_revision。
切换选项或卸载取消旧请求，不让旧响应覆盖新视图。日志保留游标，最多保留256KiB展示内容。
界面语言（zh-CN/en）保存在浏览器本地；服务端业务状态不因语言改变。所有展示文案
来自`src/simple_impl/ui/src/i18n/messages/`，键树与插值占位符在两种语言间保持一致。

## Visualization

复用ChartBundle/ChartSpec及ComparisonData，保留sources、null、units和granularity。每条序列最多展示1000个点，采样不插值、不填补缺失，并明确显示原始点数；完整数据可导出。
