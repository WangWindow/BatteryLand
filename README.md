# BatteryLand

BatteryLand 是电池实验与结果分析平台。你可以在网页中登记数据来源、管理电池与划分、准备实验配置、提交训练任务，并查看日志、结果、产物和对比图表。

## 环境要求

- Python 3.14 与 `uv`
- Bun 1.4+
- Linux（真实训练需要可用的 CPU 或 CUDA 环境）

## 1. 安装依赖

在仓库根目录执行：

```bash
cd /home/choco/code/BatteryLand
uv sync
```

安装前端依赖：

```bash
cd src/simple_impl/ui
bun install --frozen-lockfile
```

## 2. 初始化数据目录

```bash
cd /home/choco/code/BatteryLand
uv run batteryland init --data-dir ./var
```

运行数据会保存在 `./var`。同一数据目录只能有一个后端服务实例。

## 3. 启动服务

使用三个终端分别启动后端、调度器和前端。

### 终端 1：后端

如果使用真实数据目录，先设置允许的来源别名：

```bash
export BATTERYLAND_SOURCE_ROOTS='{"battery-life":"/data/BatteryLife_Processed"}'
```

然后启动：

```bash
cd /home/choco/code/BatteryLand
uv run batteryland serve --data-dir ./var --host 127.0.0.1 --port 8000
```

接口文档：<http://127.0.0.1:8000/docs>

### 终端 2：调度器

实验提交后必须由调度器派发才会开始执行：

```bash
cd /home/choco/code/BatteryLand
uv run python -m simple_impl.scheduler --base-url http://127.0.0.1:8000
```

调度器默认每秒检查一次队列。停止调度器后，排队任务会保持等待，已有任务仍可查看和停止。

### 终端 3：前端

```bash
cd /home/choco/code/BatteryLand/src/simple_impl/ui
bun run dev
```

打开：<http://127.0.0.1:5173>

侧栏或移动端顶部可以切换 **简体中文 / English**。

## 4. 使用工作台

### 4.1 登记数据来源

进入 **数据来源与电池**，点击 **登记来源**。

- `名称`：页面上显示的名称，例如 `CALCE`。
- `来源别名`：必须是后端环境变量 `BATTERYLAND_SOURCE_ROOTS` 中配置的键，例如 `battery-life`。

来源登记成功后，后端会检查对应目录是否可访问。

### 4.2 导入电池清单

在 **数据来源与电池** 点击 **导入清单**，选择 JSON 文件。支持两种格式：

```json
[
  { "file_name": "cell-a.pkl" },
  { "file_name": "cell-b.pkl" }
]
```

```json
{
  "batteries": [
    { "file_name": "cell-a.pkl" },
    { "file_name": "cell-b.pkl" }
  ]
}
```

导入后会显示新增、已存在和错误数量。重复导入不会重复创建电池。

### 4.3 创建数据划分

进入 **数据划分**，点击 **新建划分**：

- **手动**：必须为每块已选电池指定训练、验证或测试集合。
- **随机**：设置三个集合比例和随机种子。
- **混合**：手动固定部分电池，其余按比例随机分配。

保存后会生成新版本。编辑已有划分需要提交当前修订号，避免覆盖他人的修改。划分可以导出为 JSON，也可以从已有 JSON 导入。

### 4.4 准备模板和组件

- **实验模板**：保存一份可复用的原生训练配置，支持从 YAML/JSON 导入、编辑和导出。
- **组件与权重**：查看 provider 提供的组件及参数，上传组件 Python 文件，或登记已有权重文件。

模板不会随实验修改而改变；实验创建时会保存自己的配置快照。

### 4.5 创建实验

进入 **实验**，点击 **新建实验**：

1. 填写实验名称。
2. 选择实验类型：训练、评估或迁移。
3. 可从模板填充配置，或直接编辑 JSON。
4. 按需绑定数据划分、源域/目标域划分和预训练权重。
5. 点击 **创建草稿**。

设备必须在配置的 `mate.device` 中显式写为 `cpu` 或 `cuda:N`，不支持 `auto`。

### 4.6 校验、提交和停止

- **执行校验**：检查配置、绑定和运行条件，不会启动训练。
- **提交到队列**：冻结实验输入并进入等待队列。
- **请求停止**：停止排队中或运行中的实验；页面显示“已停止”时才代表进程已经退出。

同一个实验只执行一次。需要重新执行时，复制为新的草稿再提交。

### 4.7 查看日志、结果和产物

打开实验详情页：

- **概览**：状态、设备、时间、停止阶段和版本绑定。
- **日志**：增量读取训练日志或控制台输出，最多保留 256 KiB；日志游标失效会自动提示并重新读取。
- **结果**：查看指标、预测值和真值。缺失指标或真值会显示为不可用，不会补零。
- **产物**：下载已登记的配置、日志、权重和结果文件。

### 4.8 比较与图表

进入 **结果比较**：

1. 勾选一个或多个已完成实验。
2. 查看指标行和预测行，可导出 JSON 或 CSV。
3. 选择图型并生成浏览器图表：
   - 指标柱状图
   - 轮次曲线
   - 预测散点图
   - 集合数量
   - 集合重叠
   - 分类分布

集合类图表需要选择数据划分和分区。图表按需加载；普通页面不会下载绘图库。

## 5. 导入内置数据（可选）

内置数据包含 1,001 条电池引用、23 份划分和示例模板。

1. 先在网页或接口中登记一个来源，别名必须已配置在 `BATTERYLAND_SOURCE_ROOTS`。
2. 获取来源 ID：

```bash
curl -s http://127.0.0.1:8000/api/v1/data-sources
```

3. 停止后端服务，执行导入：

```bash
uv run batteryland import-bundled \
  --source-id <来源ID> \
  --data-dir ./var
```

4. 重新启动后端和调度器。

## 6. 真实训练

真实训练由 `deeplatform` 子模块执行。默认 CALCE 验收需要本机存在 `/data/BatteryLife_Processed`。

```bash
# CPU
uv run pytest tests/training --run-training

# CPU + CUDA
uv run pytest tests/training --run-training --run-gpu
```

普通实验在网页提交后，仍会经过独立调度器派发。

## 7. 验证安装

```bash
# 后端
uv run pytest tests
uv run ruff check src/batteryland src/simple_impl tests
uv run ty check

# 前端
cd src/simple_impl/ui
bun run verify
bun run test:e2e
```

真实浏览器 MyTask（需要可用的训练环境）：

```bash
cd /home/choco/code/BatteryLand
bash tests/run_e2e_real.sh
```

## 8. 常见问题

**实验一直显示“排队中”**
检查调度器是否运行：

```bash
uv run python -m simple_impl.scheduler --base-url http://127.0.0.1:8000
```

**登记来源提示别名不可用**
确认启动后端前已设置 `BATTERYLAND_SOURCE_ROOTS`，并且填写的是别名而不是绝对路径。

**提示另一个后端正在使用该数据目录**
同一 `--data-dir` 只能运行一个后端。停止已有进程后再启动或执行 `import-bundled`。

**停止请求已受理但没有立刻停止**
停止需要训练进程实际退出。页面显示“已停止”或状态变为 `stopped` 后才算完成。

**修改了后端端口**
调度器和前端需要同步修改：

```bash
uv run python -m simple_impl.scheduler --base-url http://127.0.0.1:9000

cd src/simple_impl/ui
VITE_PROXY_TARGET=http://127.0.0.1:9000 bun run dev
```

**提示执行身份需要核对**
该执行不会被自动重跑。请使用后端运维命令核对：

```bash
uv run batteryland reconcile --experiment-id <实验ID> --data-dir ./var
```

## 相关文档

- [工作台使用与验收](specs/003-modular-workflow/quickstart.md)
- [HTTP 接口](http://127.0.0.1:8000/docs)
- [能力与限制](specs/001-backend-experiment-platform/contracts/capabilities.md)
- [开发规范](.specify/memory/constitution.md)
