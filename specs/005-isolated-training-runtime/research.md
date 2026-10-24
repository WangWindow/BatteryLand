# Research: 双环境与查询缓存

- **Decision**: 根项目同一声明/锁，API默认dev，训练仅training组。**Rationale**: 不复制依赖，不改子模块。**Alternative**: 独立项目/锁目前没有版本冲突，不引入。
- **Decision**: 配置的解释器直接启动worker。**Rationale**: uv run会自动同步；直接执行保持进程所有权清晰。解释器符号链接不能resolve。
- **Decision**: 静态组件操作保留API解释器。**Rationale**: provider的AST工具仅需标准库，训练环境缺失仍可管理组件。
- **Decision**: 只缓存静态列表，内容指纹覆盖两个根的components/task所有Python源码。**Rationale**: 即时检测编辑、增删与替换，缓存返回副本。**Alternative**: 动态catalog缓存虽然可减少科学库导入，但还需处理运行中依赖安装与任意模块导入失效，本轮保持实时。
- **Baseline**: 相同19组件连续列表查询为0.1065、0.1076、0.1098秒；共享环境约6.1G。这是查询和安装体积基线，不是API内存测量。

## Primary sources

- [uv环境路径](https://docs.astral.sh/uv/concepts/projects/config/#project-environment-path)：一个项目选择不同环境目录。
- [uv同步](https://docs.astral.sh/uv/concepts/projects/sync/)：only-group排除项目及默认依赖；精确同步会移除未选择的包。
- [uv联合解析限制](https://docs.astral.sh/uv/concepts/resolution/#conflicting-dependencies)：安装集合隔离不等于解除统一锁的版本约束。
- [Python venv](https://docs.python.org/3.14/library/venv.html)：环境隔离包集合，重建而不移动环境。
