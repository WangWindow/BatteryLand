# BatteryLife 数据层三页接入

## 范围

BatteryLand 侧栏“数据”下的“电池详情”“数据概览”“多曲线对比”分别打开 `/data-layer/`、`/data-layer/overview`、`/data-layer/trends`。三页沿用 BatteryLife_Web 提交 `fa7c0ae` 的 HTML、CSS、图表和数据口径，页面资源和只读 API 通过 BatteryLand 同一站点提供。页面之间仍使用原 Web 导航；浏览器“返回”可回到 BatteryLand。

本阶段没有数据导入页面，也没有注册导入接口。原有“电池目录”“数据划分”和实验流程保持原样。原始 `.pkl` 文件只读；索引、核验报告、交付清单和轨迹缓存写在 `BATTERYLAND_DATA_DIR/data-layer/`，默认 `var/data-layer/`。

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

在服务器项目根目录运行 `./scripts/run-batterylife-data-layer.sh`。这个演示入口固定使用已准备索引的 `var/data-layer/`、原始数据目录 `/data/BatteryLife_Processed`、网页端口 `15173` 和后端端口 `18000`，不受终端里旧的 `BATTERYLAND_DATA_DIR` 设置影响；按 Ctrl+C 关闭。启动前若索引缺失，会直接提示需要准备索引。浏览器访问 `http://222.195.7.189:15173`，从侧栏“数据”组进入三个页面；开发服务器已代理 `/data-layer` 到同一后端，无须启动第二个公开站点。建议检查：

1. 详情页选择 `MATR_b4c0`，确认容量轨迹、Cycle 采样、选圈联动；用 `CALB_0_B183` 区分寿命标签与详细记录终点。
2. 概览页确认桑基图、筛选与退化轨迹能读取当前索引。
3. 多曲线页跨来源添加电池并绘制曲线，再检查页面内部跳转和浏览器返回。
4. 检查原有电池目录、数据划分和实验入口仍可用；`/data-layer/intake` 和 `/data-layer/api/intake/*` 应返回 404。

页面代码基于原 Web 已提交版本复制；原 BatteryLife_Web 工作区和服务器原始数据不参与改动。若未来更改原 Web 功能，需要选择性同步三页对应的页面、脚本与只读数据处理逻辑。
