# Implementation Plan: 独立训练环境与组件查询优化

**Branch**: `005-isolated-training-runtime` | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md)

## Summary

API使用根`.venv`，训练使用`.venv-training`；依赖保持在主项目分组声明。静态inspect/upload由API解释器执行，动态catalog/validate/prepare和训练由配置的训练解释器执行。使用标准输入输出JSON及文件，保留内置调度、进程组监督及既有HTTP契约。

## Technical Context

- Python >=3.14、uv；当前FastAPI、SQLAlchemy、PyTorch版本保持不变。
- SQLite与JSON存储无迁移；前端无变化。
- pytest契约/集成/真实训练、Ruff、ty、构建；Linux进程组。
- 冷查询保留真实解析，重复静态查询省去解释器启动和AST解析；不承诺API内存降幅。
- 一个根依赖声明和锁；安装集合分离，但依赖解析仍联合约束。未来真实冲突另立规格。

## Constitution Check

- 用户已授权双环境替换共享环境条款，宪章升为4.0.0；专业模块所有权及前后端职责不变。
- 变化只在配置和训练适配层，领域与应用层不依赖解释器细节。
- HTTP/ORM/存储/界面不变；运行身份契约与失败路径有测试。
- 按规格先测红再实现；保留真实CPU/GPU、停止、恢复验收。
- 缓存只存可重建静态数据，失败不缓存，训练验证不缓存。
- 设计后复查通过，无额外基础设施或原则例外。

## Project Structure

```text
src/batteryland/config.py
src/batteryland/infrastructure/training/{gateway,runtime,bridge}.py
tests/contract/test_isolated_runtime.py
tests/contract/test_component_cache.py
tests/training/test_real_training.py
pyproject.toml
README.md
```

## Implementation

1. 默认依赖组仅dev，training显式声明PyYAML；训练`--only-group training --compile-bytecode`，不安装主项目或API依赖；安装时预编译第三方依赖，避免每个短进程重复编译。
2. Settings支持`BATTERYLAND_TRAINING_PYTHON`，默认仓库`.venv-training/bin/python`，转绝对路径但不解引用解释器符号链接。
3. 训练运行时以标准库探针惰性获取解释器、prefix、版本并核验；清理子进程环境中的API激活信息，设置训练PATH/VIRTUAL_ENV。
4. 静态桥接校验API身份，动态桥接校验指定训练身份，spawn验证prepare回执的运行身份。环境不可用不影响启动/观察/停止。
5. 静态组件缓存按provider提交及components/task源码内容指纹失效，上传主动失效，锁合并并发查询，返回副本。动态描述与训练验证保持实时，避免引入环境缓存失效规则。
6. 实际建立训练环境后再清理API环境中的训练依赖，执行端到端验收，分步提交合并。

## Complexity Tracking

无例外。一个根声明、两个安装集合、原有本地进程协议；不增加常驻服务。
