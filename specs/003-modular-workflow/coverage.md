# 需求覆盖与模块归属

评估日期：2026-10-24。001/002 的完成表示各自范围的交付，不表示原始合同全部完成。

| 需求 | 现有接口/能力 | 证据 | 本轮安排与归属 |
| --- | --- | --- | --- |
| 来源、电池分类检索 | data-sources、batteries | test_resources、test_workflow | 补前端管理入口；来源仍为允许目录的清单登记，不是任意原始数据上传治理 |
| 划分管理 | splits、members、import/export | test_splits_api、test_splits | 补网页；provider自定义划分执行入口仍缺失 |
| 模板与配置管理 | templates、experiments | test_experiments | 补网页、编辑、校验和复制 |
| 组件上传、预览、参数 | components、schema、uploads | test_components、test_training | 前端调用引擎，训练核心归deeplatform |
| 权重登记与下载 | checkpoints、artifacts/download | test_components、test_results | 补网页，不反序列化权重 |
| 真实训练 | train、显式cpu/cuda:0 | 002/quickstart、test_real_training | 完成浏览器与独立scheduler联调 |
| 串行调度和停止 | queue、stop，现内嵌FIFO | test_scheduler、test_recovery | 迁出策略，增加派发API；引擎保留进程所有权 |
| auto与多卡并行 | 当前拒绝auto，串行容量1 | capabilities、设备拒绝测试 | 后续feature；本轮不伪装支持 |
| 日志、指标、预测、产物 | logs/SSE、metrics、results、artifacts | test_results | 补监控与下载页面 |
| 多实验比较 | comparisons、export | test_analysis、test_analysis_api | 浏览器展示并集、null、任意指标与来源 |
| 集合差异 | counts/overlap/category_distribution | test_analysis | 补浏览器图表；统计基于已登记元数据 |
| 六种图型 | charts返回bar/line/scatter描述 | test_analysis_api | visualizer在浏览器绘图，不生成图片文件 |
| 完整数据概览桑基图 | 缺专门聚合与图型 | 原始功能需求 | 后续feature |
| 退化轨迹、原始信号和衍生特征 | 无标准化时序读取契约 | 原始功能需求 | 后续feature，不由前端读取pickle |
| 原始数据上传治理、质量检查 | 仅清单登记，未交付治理流水线 | ResourceService范围 | 后续feature |
| 独立评估和迁移学习 | 可存配置，执行入口尚未交付 | gateway前置条件 | 后续与训练模块维护者对齐 |
| 不确定性、微调诊断和导出推理代码 | 无交付能力 | 原始功能需求 | 后续feature |

浏览器尚未实现，独立调度尚无派发入口，因此当前后端不能宣称已通过网页全流程验收。
现有48个HTTP操作通过契约测试；本轮补充接口必须更新机器契约并由真实HTTP消费者验证。
