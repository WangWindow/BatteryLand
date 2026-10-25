# DeepPlatform 自定义划分接口请求

当前 `BatteryLifeDatasetFactory` 从子模块内置 `data_split/*.json` 按 `dataset` 名称选择
训练、验证、测试文件。BatteryLand 已能校验并保存每个实验的完整划分 JSON，但在提供者支持前，
自定义划分不能交付真实训练。本文件记录给 DeepPlatform 维护者的最小接入请求；
主项目不修改其源码。

## 请求的能力

- 在 `datafactory.params` 中增加可选 `split_file`（或等效参数）。未设置时保留当前内置划分行为。
- 文件内容为 `{ "dataset": string, "train": string[], "val": string[], "test": string[] }`。
  解析时拒绝重复 JSON 字段、空文件名、重复成员和跨分区重叠，并返回明确错误。
- 训练进程只读取由 BatteryLand 在该实验独立运行目录中提供的只读划分文件；
  路径必须位于受控目录内。配置中的 `dataset` 与 JSON 中的 `dataset` 一致。
- 文件名与真实电池文件应有可验证的一一对应关系。当前固定池存在跨原始文件夹重名；
  需约定稳定的相对路径或文件 ID，以避免扁平软链接覆盖。无法唯一定位时应拒绝运行。
- 校验入口和实际训练入口使用相同的解析与文件定位规则；校验成功后，
  适配器才会签发 `execution_supported=true` 的收据。

该接口可选，不要求提供者改变已有内置划分格式。独立评估与迁移训练为另一个能力请求。
