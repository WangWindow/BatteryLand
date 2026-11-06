# BatteryLand 数据层技术说明

## 范围

BatteryLand 侧栏“数据”下的“电池详情”“数据概览”“多曲线对比”分别打开 `/data-layer/`、`/data-layer/overview`、`/data-layer/trends`。三页沿用 BatteryLife_Web 提交 `fa7c0ae` 的图表和数据口径，页面资源和只读 API 通过 BatteryLand 同一站点提供。三个数据层页面使用统一的 BatteryLand 顶栏与页面导航；点击顶栏品牌返回 BatteryLand 电池目录 `/batteries`。详情页的选电池侧栏和图表内容均从顶栏下方开始。

本阶段没有数据导入页面，也没有注册导入接口。原有“电池目录”“数据划分”和实验流程保持原样。原始 `.pkl` 文件只读；索引、核验报告、交付清单和轨迹缓存默认写在 `BATTERYLAND_DATA_DIR/data-layer/`。专用演示脚本通过 `BATTERYLAND_DATA_LAYER_CACHE_DIR` 使用已准备的 `var/data-layer/`，不改变平台其他状态文件的位置。

## 页面样式

三个数据层页面保留原有板块、布局、交互和曲线颜色。当前浅色样式只将共用顶栏改为白底，并将电池详情的选电池侧栏改为浅灰白底 `#f6f8fa`，同时调整这些区域内的文字、输入框和选中状态。其余内容区仍沿用原页面样式；数据层页面尚不随 BatteryLand 的浅色／深色主题切换。

数据层样式集中在 `src/batteryland/data_layer/legacy/static/` 下的 `theme.css`、`site-header.css` 和 `styles.css`。这些修改不影响 BatteryLand 其他页面，也不改变图表数据或 `--chart-*` 配色变量。

## 数据目录与首次准备

默认读取 `/data/BatteryLife_Processed`。若数据目录不同，启动前设置 `BATTERYLAND_SOURCE_ROOTS`，其中 `battery_life` 指向包含 `Life labels` 的原始数据目录。首次开放三页之前，在项目根目录运行：

```bash
UV_DEFAULT_INDEX=https://pypi.org/simple uv sync --locked --python 3.14 --no-config
.venv/bin/python -m batteryland.data_layer.prepare
```

准备命令依次生成目录索引、元数据核验、前 100 条 Cycle 完整性核验和交付清单。已建立的目录索引会复用未变化的文件；目录变化后重新运行即可。检查缓存文件：

```bash
ls -lh var/data-layer/catalog.sqlite3 var/data-layer/quality_flags.json \
  var/data-layer/early_cycle_integrity.json var/data-layer/delivery_manifest.json
```

`scripts/run.sh` 不会自动执行上述数据层准备命令；BatteryLand 原有的电池目录自动扫描也不会生成这里的 `catalog.sqlite3`。若页面提示“数据目录索引尚未建立”，先确认启动服务和运行准备命令时使用相同的 `BATTERYLAND_DATA_DIR` 与 `BATTERYLAND_SOURCE_ROOTS`。例如服务使用 `BATTERYLAND_DATA_DIR=/srv/batteryland-var` 时，准备命令也应带上相同环境变量；索引应位于 `/srv/batteryland-var/data-layer/catalog.sqlite3`。若提示“索引对应另一份数据目录”，还需核对 `battery_life` 指向的原始数据根目录。索引就绪后刷新数据概览或多曲线对比页即可。

轨迹缓存 `trajectory_cache.sqlite3` 在首次打开数据概览后于后台逐块生成；完成的结果可在下次启动复用。准备和轨迹生成都不会向原始数据目录写入文件。

## 启动与验证

平台通用启动入口仍是根 README 中的 `./scripts/run.sh`。首次使用三页前，先按上节准备数据层索引；准备和启动须使用同一份 `BATTERYLAND_DATA_DIR` 与 `BATTERYLAND_SOURCE_ROOTS`。默认配置下，索引位于 `var/data-layer/catalog.sqlite3`。若启动时需要把平台运行状态放在另一个 `BATTERYLAND_DATA_DIR`，可设置 `BATTERYLAND_DATA_LAYER_CACHE_DIR` 指向已经准备好的索引目录；这样无需重新建立索引。

按 Ctrl+C 关闭服务；从侧栏“数据”组进入三个页面，无须启动第二个公开站点。

如需同时保留旧版并预览新样式，应在不同代码目录分别启动，并为两套服务设置不同的网页和后端端口。页面版本由启动命令所在的代码目录决定；仅更换端口不会切换到另一版本。开发完成后关闭预览服务，再由验收人员按需启动。

更新数据层页面或服务代码后重启服务。三页 HTML 不使用浏览器缓存，静态资源在使用前重新验证；从旧版本升级时，已有标签页仍需按 Ctrl+F5 强制刷新一次。

建议检查：

1. 详情页选择 `MATR_b4c0`，确认容量轨迹、Cycle 采样、选圈联动；用 `CALB_0_B183` 区分寿命标签与详细记录终点。
2. 概览页确认桑基图、筛选与退化轨迹能读取当前索引。
3. 多曲线页在候选列表中滚动查看全部匹配电池，跨来源添加电池并绘制曲线，再检查页面内部跳转和浏览器返回。
4. 检查原有电池目录、数据划分和实验入口仍可用；`/data-layer/intake` 和 `/data-layer/api/intake/*` 应返回 404。

页面代码基于原 Web 已提交版本复制；原 BatteryLife_Web 工作区和服务器原始数据不参与改动。若未来更改原 Web 功能，需要选择性同步三页对应的页面、脚本与只读数据处理逻辑。

## 历史服务器辅助脚本

`./scripts/run-batterylife-data-layer.sh` 保留用于已有服务器环境。它先检查 `/data/BatteryLife_Processed` 和 `var/data-layer/catalog.sqlite3`，再设置数据来源、索引目录及默认端口，最后调用同一个 `run.sh`。其默认网页端口为 `15173`、后端端口为 `18000`，可用 `BATTERYLAND_UI_PORT` 和 `BATTERYLAND_BACKEND_PORT` 覆盖。一般部署直接按根 README 准备数据并运行 `./scripts/run.sh`，无需使用这个辅助脚本。
