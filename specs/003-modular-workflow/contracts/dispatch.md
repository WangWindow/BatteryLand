# External Scheduler Contract

## HTTP

`GET /api/v1/queue`保持waiting/active/dispatch_paused/reason。
`POST /api/v1/queue/dispatch`请求为experiment_id、expected_revision>=1、policy_id(默认fifo，1..100字符)。
首次认领返回202 Envelope[Experiment]；重复已认领/终态返回200同一DTO，不再次prepare或spawn。
draft、queued修订过期或其他活动执行返回409；未知实验404；待核实阻断以needs_reconciliation表达。
不接受设备、路径、配置、PID或其他未声明字段。

## Safety and Recovery

派发从状态检查到回执保存共用引擎gate；SQL状态认领在启动前提交。stop独立持久化，监控在调度器缺席时仍运行。
HTTP超时不能回滚已发生执行；客户端下次轮询读取权威状态，重试同一请求不会启动第二个进程。
后端capabilities声明engine-execution的dispatch/observe/stop能力，不推断外部scheduler在线。

## Scheduler CLI

从仓库根目录运行`uv run python -m simple_impl.scheduler --base-url http://127.0.0.1:8000`。
支持--interval(正数，默认1)、--policy fifo、--once。客户端HTTP超时90秒；冲突视为刷新信号，连接/服务错误记录并按轮询间隔恢复。
策略为独立choose(queue)接口，可由其他模块替换；不导入batteryland或deeplatform。
