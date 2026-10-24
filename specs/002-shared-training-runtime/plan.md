# Implementation Plan: 共享环境的真实训练联调

**Branch**: `001-backend-experiment-platform`（保留当前工作区） | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md)

## Summary

统一根目录 .venv，训练依赖在根 pyproject 的 training 组声明，共用 uv.lock。
桥接和训练使用 sys.executable，保留进程隔离。顺序为 MyTask → CALCE CPU → CALCE cuda:0 → 停止/恢复。
子模块固定 6b4c76d6e639ddaf9db9c15bf04771179a68d988，不修改、不新增 pyproject。

## Technical Context

**Language/Version**: Python >=3.14，当前 CPython 3.14.7。
**Primary Dependencies**: 保留后端兼容锁版本；新增 accelerate、denseweight、evaluate、joblib、matplotlib、numpy、pandas、peft、scikit-learn、scipy、torch、tqdm、wandb；复用 PyYAML。
**Storage**: 现有 SQLite/不可变 JSON，prepared JSON 可附环境身份，无迁移。
**Testing**: pytest 红绿重构；普通测试不依赖实际GPU/数据；真实训练显式启用。
**Target Platform**: Linux，驱动595.99.02，明确cpu/cuda:0。
**Project Type**: 后端运行时集成。
**Performance Goals**: 保持常用查询p95<=2s；API不导入torch；不设训练速度指标。
**Constraints**: 不降级Python，不重编号设备，不改框架核心，不新增公共HTTP操作。
**Scale/Scope**: CALCE13电池9/2/2，单轮CPU/GPU与长实验生命周期。

## Constitution Check

| 门槛 | 设计前/后 |
| --- | --- |
| 所有权、前后端分离 | PASS：宿主适配与验收，子模块不变 |
| DDD/数据职责 | PASS：原接口和仓储保持，环境校验在训练基础设施 |
| 生命周期/设备 | PASS：原状态机，同一解释器独立进程，明确设备 |
| SDD/TDD | PASS：规格先行，测试先于行为修改 |
| 环境与复杂度 | PASS：用户已确认共享环境，复用uv依赖组和锁 |
| 真实性 | PASS：真实样例与替身分开，失败明确记录 |

## Project Structure

- src/batteryland/config.py：去除第二解释器配置。
- src/batteryland/infrastructure/training/：统一解释器，控制响应环境身份与prefix校验，prepare保存环境信息。
- tests/contract/test_shared_runtime.py：调用、环境身份与依赖缺失。
- tests/training/：显式启用的真实任务、设备与生命周期验收。
- pyproject.toml、uv.lock、README.md：training默认组和使用说明。

## Workflow and Data Flow

1. 先验证共享环境行为的有效失败测试，不把缺包ImportError作为红测试证据。
2. training依赖组与default-groups=[dev,training]统一解析，保留既有兼容版本。
3. 不resolve虚拟环境解释器符号链接；子进程使用sys.executable。响应报告executable/prefix/python_version，宿主验证prefix。
4. catalog真实导入决定available；inspect/upload静态操作仍不加载科学依赖。测试显式模拟不可用，不依赖机器恰好缺包。
5. CALCE现有配置复制为验收输入，epochs=1、num_workers=0、明确设备，其他保持原生值。
6. 单轮产物经现有采集查询核验，长实验核对重启身份与停止退出。
7. 实际设备证据来自训练日志与GPU PID/UUID观察；没有结构化证据的effective_device继续为空。

## Delivery and Validation

旧测试、共享环境契约、provider自带测试和真实训练分别报告。
发现provider失败保留复现、输入与日志，完成不受影响的宿主工作，不修改001历史验收事实。

## Complexity Tracking

不新增服务、数据库结构、设备选择算法或通用插件框架。
