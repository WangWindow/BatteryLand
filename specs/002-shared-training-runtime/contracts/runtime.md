# Runtime Contract

- 根.venv供API与训练共用，Python约束保持。
- 移除BATTERYLAND_TRAINING_PYTHON与Settings.training_python，工作进程使用sys.executable原路径。
- bridge响应保留ok/data/error，附runtime={executable,prefix,python_version}。
- prefix不匹配时拒绝结果；prepare/upload有副作用时标needs_reconciliation。
- prepare返回内部runtime加入回执，spawn仍调用原main.py --experiment-dir。
- 48个HTTP操作及DTO/错误码不变，available由真实catalog导入决定。
- 普通测试显式模拟缺依赖；真实训练需显式开启，普通测试不读取电池pickle或分配GPU。
- 原产物和生命周期遵守[首版契约](../../001-backend-experiment-platform/contracts/capabilities.md)。
