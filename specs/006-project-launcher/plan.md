# Plan: 一键启动

- 使用Bash脚本，基于`BASH_SOURCE`定位项目根目录，默认路径及相对配置均以此目录为基准。
- 复用现有Python CLI和Bun/Vite入口，直接启动已安装的环境；不增加依赖管理或常驻服务。
- Linux `setsid`隔离两个服务的进程组；信号及子进程退出统一触发清理，Vite使用strictPort。
- 环境变量：`BATTERYLAND_BACKEND_PORT`、`BATTERYLAND_UI_PORT`、既有`BATTERYLAND_DATA_DIR`及`BATTERYLAND_TRAINING_PYTHON`。
- 验证：受控进程测试异地工作目录、含空格路径、Ctrl+C、任一服务失败和子进程清理；再从异地目录进行真实HTTP启动/代理/退出冒烟。
- Constitution Check：只新增开发入口；前后端、DDD、存储和训练所有权不变。按行为先测后实现，完成后及时提交并合入本地main。
