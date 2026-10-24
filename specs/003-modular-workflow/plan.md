# Implementation Plan: 模块化实验工作台闭环

**Branch**: `003-modular-workflow` | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md)

## Summary

保留SQLite/JSON权威存储及deeplatform训练，迁出FIFO任务选择，通过一个新增HTTP派发接口驱动引擎。
交付单个React工作台，资源/配置/执行管理与visualizer内部解耦，浏览器绘制现有六种图型。

## Technical Context

**Language/Version**: Python>=3.14、TypeScript严格模式；同一根Python环境。
**Primary Dependencies**: FastAPI/SQLAlchemy原版本；scheduler使用HTTPX；React/Vite/shadcn(radix,nova)/Tailwind；Bun、Biome、Recharts、openapi-typescript。
**Storage**: 既有SQLite及不可变JSON，无新增数据服务或迁移。
**Testing**: pytest红绿、Vitest/RTL、Playwright、真实CPU/GPU显式验收；Ruff/ty/Biome/tsc/build。
**Target Platform**: 本地Linux后端，现代桌面与窄屏浏览器。
**Project Type**: 数据及执行引擎+独立HTTP调度进程+前端应用。
**Performance Goals**: 保持已有查询基准；非图表页不加载Recharts，列表分页<=200，日志64KiB分块与有界显示。
**Constraints**: 不改deeplatform，不引入Redis，不拆前端包，首期仅显式设备和容量1。
**Scale/Scope**: 既有1001电池/23划分/100实验基准；六个故事覆盖现有能力闭环。

## Constitution Check

| 门槛 | 设计前/后 |
| --- | --- |
| 引擎/前端/训练/调度职责 | PASS：HTTP隔离，主进程不导入科学框架 |
| 轻量DDD、ORM和一致性 | PASS：复用现有仓储，副作用不进入SQL事务 |
| 可替换与复杂度 | PASS：FIFO策略独立，无新数据库或服务端绘图 |
| SDD/TDD | PASS：规格先提交，各业务测试先失败再实现 |
| 统一前端与性能 | PASS：单应用、Bun/Biome、按需浏览器绘图 |
| Git边界 | PASS：规格、引擎、scheduler、前端及验收分批提交 |

## Project Structure

- `src/batteryland/`：新增派发用例和接口，监控循环只观察/停止/采集。
- `simple_impl/scheduler/`：无引擎内部导入的HTTP客户端、FIFO策略、CLI。
- `simple_impl/ui/`：一个package.json与bun.lock；api、components、pages、visualizer分离。
- `tests/integration/test_dispatch.py`、`tests/unit/test_scheduler_client.py`：派发与独立客户端契约。
- 前端`tests/`及`e2e/`：交互、错误、图表、真实HTTP主流程。

## Execution Design

引擎保留单运行根独占锁。dispatch与tick共用进程内gate；首次派发检查revision与任何活动任务，再用现有CAS认领并提交，随后prepare/spawn。
重复请求返回既有实验，绝不重新执行。停止不获取gate，保留准备期间的取消语义。tick只观察、停止和采集；无scheduler时排队等待。
独立scheduler每1秒GET queue，活动/暂停时不派发；FIFO选waiting第一项，POST dispatch。HTTP冲突或超时后重新查询，不重建草稿或启动意图。

## Frontend Design

前端使用同源相对`/api/v1`及Vite开发/预览代理，生产同域反向代理；不增加默认宽泛CORS。
用OpenAPI生成DTO，小型fetch客户端统一envelope、错误、上传、下载和取消；页面不复制模型。
以紧凑侧栏、页头、工具栏、数据表和详情编辑区组织；主题为slate中性底色与克制蓝色强调，统一shadcn控件。
页面懒加载，visualizer仅由比较页动态引用；六种ChartBundle描述转换成Recharts浏览器组件。
原始JSON配置提供清晰标签和提交校验，组件参数描述可查看，来源/划分/模板用选择控件，不创建通用表单引擎。

## Complexity Tracking

无宪章例外。首期不新增调度租约、认证系统、分布式队列、独立绘图服务或多包工作区。
