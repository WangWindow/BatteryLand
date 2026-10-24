# Quickstart: 独立训练环境

在仓库根执行：

```bash
uv sync --locked
UV_PROJECT_ENVIRONMENT=.venv-training uv sync --locked --only-group training
uv run batteryland init --data-dir ./var
uv run batteryland serve --data-dir ./var
```

API部署可用`uv sync --locked --no-default-groups`只装运行依赖。不同位置的训练环境通过`BATTERYLAND_TRAINING_PYTHON=/absolute/path/bin/python`选择；不对入口执行realpath。训练调试直接运行`.venv-training/bin/python`，避免普通uv run自动改变该环境安装集合。

```bash
uv run pytest tests -q
uv run ruff check src/batteryland tests
uv run ty check
uv run pytest tests/training --run-training --run-gpu -q -s
bash tests/run_e2e_real.sh
```

验证API解释器不能找到torch，训练解释器可导入torch/yaml且无需安装batteryland/fastapi。未配置或缺失训练环境时，资源与静态组件API正常，动态检查明确失败。真实CPU/GPU训练、重启停止及浏览器MyTask作为最终验收。

## Evidence

待实施后补充实际结果。
