# Local runtime contract

- API默认`.venv`，训练默认`<repo>/.venv-training/bin/python`；`BATTERYLAND_TRAINING_PYTHON`支持显式覆盖，相对路径以启动工作目录为基准。保留虚拟环境符号链接入口。
- inspect/upload使用API解释器；catalog/validate/prepare及main.py使用训练解释器。均无shell激活和HTTP服务。
- 训练运行时惰性探测，返回executable/prefix/python_version；响应必须与所选解释器身份一致。环境缺失、无效响应和不匹配必须明确失败，不回退。
- prepare内层runtime与控制响应身份一致；spawn只接受当前训练身份的回执。receipt记录runtime以追溯；存量进程仍按原receipt观察和停止。
- 训练子进程PATH和VIRTUAL_ENV对应训练环境，移除继承的PYTHONHOME；PYTHONPATH仅含provider及上传目录。
- 静态缓存复用不跳过provider版本/洁净性检查；源码内容变化即失效，上传成功主动失效。失败、设备校验、配置校验及训练结果不得缓存。
- HTTP OpenAPI不变；旧共享运行时规格002由本契约覆盖。
