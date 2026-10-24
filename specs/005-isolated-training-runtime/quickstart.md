# Quickstart: 独立训练环境

在仓库根执行：

```bash
uv sync --locked
UV_PROJECT_ENVIRONMENT=.venv-training uv sync --locked --only-group training --compile-bytecode
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

- 后端89 passed/4 skipped（27.14秒），Ruff检查与96文件格式检查、ty、源码包和wheel构建通过。
- 后端环境32个包、约117MiB，无法找到torch/numpy；训练环境114个包，无fastapi/batteryland。两个环境的依赖兼容检查和锁定同步检查均通过，不需要依赖版本升级。
- 运行时回归先观察6项预期失败，prepare内层身份另观察1项预期失败，再通过；缓存回归先观察4项预期失败，再全部通过。
- 组件列表微测（19个组件）：未缓存桥接四次为119.42/120.61/110.76/118.28毫秒；缓存首次127.88毫秒，随后11.48/9.09/9.13毫秒。结果仅代表适配器操作。
- 真实训练4项通过（253.33秒）：MyTask `415907e6-4089-4313-ab14-1409a0eb013f`，CALCE CPU `1fdd70e8-4a34-42c1-904b-edb41e123196`，CALCE cuda:0 `ac97d06d-bc62-40ed-9e1a-31efa728bd16`，HTTP重启停止 `75fb94ae-37c2-4f80-9267-a5cdb5995ef5`。
- CALCE CPU/GPU均取得21个指标、2份预测；GPU实际PID 1322273对应UUID `GPU-97718414-11ff-d5e7-b03e-d77dcb2bbc0f`。重启后保留原训练PID 1327501并成功停止。
- 首轮真实浏览器MyTask 1项通过（57.1秒），回执确认训练解释器为`.venv-training/bin/python`，prefix与API不同，Python3.14.7。
- 训练依赖预编译15607文件（28.03秒），训练环境从约5.9GiB增至6.3GiB。控制查询对照见[research.md](research.md)：相同动态查询的源码导入23.30/25.13秒、预编译导入10.41/10.03秒，未缓存动态校验。
- 最终预编译安装再次完成真实浏览器MyTask：1 passed（27.1秒，实际用例26.4秒）。
- 检查含一条Starlette对HTTPX测试客户端的非阻塞弃用提示；本轮没有改变HTTP客户端依赖。
- deeplatform固定提交与源码保持不变，未新增pyproject或HTTP服务。
