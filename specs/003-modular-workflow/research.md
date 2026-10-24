# Research: 模块化实验工作台

## 独立派发与安全

**Decision**: 新增POST queue/dispatch，复用现有状态CAS、运行根锁与tick gate；监控保留在引擎。
**Rationale**: 两个不同任务的并发派发必须受全局容量限制；整个prepare/spawn区间持gate防止监控误判无回执starting。
**Alternatives considered**: scheduler直写数据库、直接spawn、分布式租约和Redis均增加耦合或环境成本。外部进程只调用公开接口。

## 前端单应用与浏览器绘图

**Decision**: shadcn Radix/nova、React/TypeScript/Vite/Tailwind，应用内部visualizer，图表采用shadcn Chart/Recharts。
**Rationale**: 当前仅一个消费者，没有独立发包需求；框架控件统一，图表在浏览器交互，路由和图表chunk按需加载。
**Alternatives considered**: 多包工作区、额外UI库、独立Python绘图服务和静态图片均无首期必要。
**Sources**: [Vite安装](https://ui.shadcn.com/docs/installation/vite)、[Chart](https://ui.shadcn.com/docs/components/base/chart)、[React lazy](https://react.dev/reference/react/lazy)。

## 工具和契约漂移

**Decision**: Bun锁文件、Biome统一lint/格式；openapi-typescript生成DTO，手写薄fetch客户端；Vitest/RTL加Playwright。
**Rationale**: 后端OpenAPI快照和前端生成类型形成双向漂移检查；不引入完整生成SDK。生成文件仅排除Biome重排，仍由tsc检查。
**Sources**: [OpenAPI CLI](https://openapi-ts.dev/cli)、[Biome](https://biomejs.dev/installation/quick-start/)、[Bun锁文件](https://bun.sh/docs/pm/lockfile)。

## 验收环境

Bun1.4.2、Node26.12.1已存在；Chromium已下载并用于真实HTTP浏览器验收。浏览器E2E使用受控训练子进程夹具；真实CALCE训练仍需显式CPU/GPU执行。自定义划分、独立评估/迁移入口仍受provider限制。
两个只读研究代理分别核对派发竞态与前端官方CLI/工具文档，未修改实现。
