# BatteryLand 自定义划分训练接入

BatteryLand 保留 Deeplatform 的 `core` 和最小 `main.py`/`frame` runner。默认组件首次初始化时复制到
`<data_dir>/plugins`，由项目目录加载；后续启动不覆盖已有文件。运行时清单记录来源提交和文件哈希。

## 配置与划分

- 调用方仍提交完整 YAML 与 `{ "dataset", "train", "val", "test" }` JSON，不提交本机路径。
- 自定义 BatteryLife 训练使用组件 `BatteryLandBatteryLifeDatasetFactory`。其 `dataset` 必须与划分 JSON 中的
  `dataset` 相同；`split_file` 由后端在执行配置中注入，不能由调用方指定。
- 划分 JSON 只接受四个规定字段；成员必须是无路径的文件名，不能重复或跨分区重叠。
- 验证通过后，后端将该实验的规范化 JSON 写入 `inputs/<experiment_id>/split.json`，权限设为只读。
  runner、后端校验和数据工厂都使用这份实验级文件，不检查其是否等于内置划分。
- 原有 `BatteryLifeDatasetFactory` 仍可读取随默认组件复制的内置划分，以支持已有配置；新建或自定义划分不依赖它。

## 文件身份与数据源

划分成员继续使用文件名。后端在配置的数据源中查找包含全部成员的根目录，重复 basename 按排序后的相对路径
选择一个稳定引用，供后端校验和训练工作区使用。当前固定数据池的同名文件内容一致；目录索引中的命名划分也将
重复文件名映射到同一个候选电池。

默认数据组件仍从项目工作区的 `data` 目录读取文件。训练进程通过 `BATTERYLAND_DATA_ROOT` 指向本次运行选中的
配置数据源；不会要求用户上传或复制原始电池文件。

## 运行边界

BatteryLand 不修改 DeepPlatform 子模块源码。`core` 与 runner 从固定版本子模块加载；默认组件、辅助工具和数据标签
从项目数据目录加载。组件或默认文件的更新需要显式迁移，服务启动不会静默覆盖用户已保存的内容。
