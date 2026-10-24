# Feature Specification: 项目相对路径的一键启动

**Branch**: `006-project-launcher` | **Created**: 2026-10-24 | **Status**: Implemented

用户在任意工作目录执行`scripts/run.sh`即可启动现有后端与前端。所有默认路径由脚本所在项目推导，支持包含空格的项目路径，不包含个人机器绝对路径。

## Acceptance

- 默认使用项目`.venv/bin/python`启动后端，项目`.venv-training/bin/python`作为训练解释器；数据默认保存到项目`var`。
- 使用Bun启动`src/batteryland_ui`，代理指向本次后端端口；默认API端口8000、UI端口5173，端口可配置，端口冲突必须失败，不自动换端口。
- 保留已配置的数据来源、训练解释器和数据目录；依赖缺失提供安装指引，不在每次启动时安装或升级依赖。
- Ctrl+C或终止脚本时清理本次前后端进程组；任一服务失败时清理另一个，并返回失败状态。不干涉训练框架已有的独立任务恢复机制。
- 不修改业务、数据库、训练适配器或前端代码。
