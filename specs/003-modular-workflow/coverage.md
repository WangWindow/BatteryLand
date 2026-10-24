# 需求覆盖与模块归属

评估日期：2026-10-24。001/002 的完成表示各自范围的交付，不表示原始合同全部完成。
本轮已交付独立scheduler、模块化工作台前端、中英文界面、真实CPU/GPU训练和真实HTTP浏览器验收。

| 需求 | 现有接口/能力 | 证据 | 本轮安排与归属 |
| --- | --- | --- | --- |
| 来源、电池分类检索 | data-sources、batteries | test_resources、test_workflow、Playwright | 工作台已交付来源登记、清单导入、检索和分页；来源仍为允许目录的清单登记，不是任意原始数据上传治理 |
| 划分管理 | splits、members、import/export | test_splits_api、test_splits、Playwright | 工作台已交付列表、创建、修订、成员、导入导出；provider自定义划分执行入口仍缺失 |
| 模板与配置管理 | templates、experiments | test_experiments、Playwright | 工作台已交付模板编辑/导入导出、实验创建、编辑、校验和复制 |
| 组件上传、预览、参数 | components、schema、uploads | test_components、test_training、Playwright | 工作台调用引擎展示真实参数并上传；训练核心归deeplatform |
| 权重登记与下载 | checkpoints、artifacts/download | test_components、test_results、Playwright | 工作台已交付登记、筛选和受控下载，不反序列化权重 |
| 真实训练 | train、显式cpu/cuda:0 | real_training、run_e2e_real.sh、Playwright | 已完成真实CPU/GPU、HTTP重启/停止及浏览器MyTask联调 |
| 串行调度和停止 | queue、dispatch、stop | test_scheduler、test_recovery、test_dispatch、test_scheduler_client、Playwright | 策略已迁出为独立HTTP scheduler；引擎保留容量、状态和进程所有权 |
| auto与多卡并行 | 当前拒绝auto，串行容量1 | capabilities、设备拒绝测试 | 后续feature；本轮不伪装支持 |
| 日志、指标、预测、产物 | logs、metrics、results、artifacts | test_results、Playwright | 工作台已交付游标增量日志、结果、预测和产物下载 |
| 多实验比较 | comparisons、export | test_analysis、test_analysis_api、Playwright | 浏览器已展示并集、null、任意指标与来源并支持JSON/CSV导出 |
| 集合差异 | counts/overlap/category_distribution | test_analysis | 补浏览器图表；统计基于已登记元数据 |
| 六种图型 | charts返回bar/line/scatter描述 | test_analysis_api、Vitest、Playwright | visualizer在浏览器绘图，不生成图片文件；每序列最多1000点并保留缺失断点 |
| 完整数据概览桑基图 | 缺专门聚合与图型 | 原始功能需求 | 后续feature |
| 退化轨迹、原始信号和衍生特征 | 无标准化时序读取契约 | 原始功能需求 | 后续feature，不由前端读取pickle |
| 原始数据上传治理、质量检查 | 仅清单登记，未交付治理流水线 | ResourceService范围 | 后续feature |
| 独立评估和迁移学习 | 可存配置，执行入口尚未交付 | gateway前置条件 | 后续与训练模块维护者对齐 |
| 不确定性、微调诊断和导出推理代码 | 无交付能力 | 原始功能需求 | 后续feature |

工作台、独立调度器和真实HTTP浏览器主流程已通过；当前OpenAPI 49个操作。
真实CPU/GPU训练及真实浏览器MyTask已执行并通过；provider自定义划分执行入口仍缺失。
中英文词典624个键由自动检查验证键树与占位符一致，源码无硬编码界面文本。
