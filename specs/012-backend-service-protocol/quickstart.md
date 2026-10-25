# 单后端 API 调用顺序

启动 `./scripts/run.sh --services-only` 后，仅使用 `http://127.0.0.1:8000`。浏览器和外部
调用方使用同一组公开接口。示例从 DeepPlatform 的 CALCE 配置与 JSON 划分创建一个逻辑划分，
再校验、保存并提交一个新实验。配置中的数据集名须与逻辑划分名相同。

```python
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import yaml

base = "http://127.0.0.1:8000/api/v1"

def request(method, path, body=None, query=None):
    url = base + path
    if query:
        url += "?" + urlencode(query, doseq=True)
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    with urlopen(Request(url, data=data, headers=headers, method=method)) as response:
        return json.load(response)["data"]

provider = Path("src/deeplatform")
config_text = (provider / "configs/calce_seed2021.yaml").read_text()
config = yaml.safe_load(config_text)
source_split = json.loads(
    (provider / "datasets/batteryLife/data_split/CALCE.json").read_text()
)
source_split["dataset"] = "CALCE"

sources = request("GET", "/data-sources", query={"page_size": 200})["items"]
source_by_id = {source["id"]: source for source in sources}
source_ids = list(source_by_id)
batteries = []
page = 1
while True:
    result = request(
        "GET",
        "/batteries",
        query={"source_ids": source_ids, "page": page, "page_size": 200},
    )
    batteries.extend(result["items"])
    if len(batteries) >= result["total"]:
        break
    page += 1

by_name = {}
for battery in batteries:
    by_name.setdefault(battery["file_name"], []).append(battery)

names = [name for part in ("train", "val", "test") for name in source_split[part]]
selected = {}
for name in names:
    matches = by_name.get(name, [])
    if len(matches) != 1:
        raise RuntimeError(f"{name} must resolve to exactly one indexed battery")
    battery = matches[0]
    selected.setdefault(battery["source_id"], []).append(battery["id"])

split = request(
    "POST",
    "/splits",
    {
        "name": source_split["dataset"],
        "source_selections": [
            {
                "source_id": source_id,
                "expected_revision": source_by_id[source_id]["revision"],
                "battery_ids": battery_ids,
            }
            for source_id, battery_ids in selected.items()
        ],
        "method": "manual",
        "partitions": {
            part: [by_name[name][0]["id"] for name in source_split[part]]
            for part in ("train", "val", "test")
        },
    },
)

validation = request(
    "POST",
    "/training/validation",
    {
        "config_text": config_text,
        "split_id": split["id"],
        "split_version": split["version"],
    },
)
if not validation["valid"]:
    raise RuntimeError(validation["limitations"])

experiment = request(
    "POST",
    "/validated-experiments",
    {
        "name": "CALCE example",
        "config_text": config_text,
        "split_text": validation["split_text"],
        "split_id": split["id"],
        "split_version": split["version"],
        "receipt": validation["receipt"],
    },
)
request("POST", f"/validated-experiments/{experiment['id']}/submit", {})
print(experiment["id"])
```

校验收据绑定配置原文、服务端生成的规范划分、提供者提交、组件版本及划分 ID/版本。提交
后实验输入冻结。同一配置再次训练须新建实验，不能复用实验 ID。

| 用途 | 接口 |
| --- | --- |
| 固定数据源与电池文件 | `GET /data-sources`、`GET /batteries` |
| 创建、查询和导出划分 | `POST /splits`、`GET /splits/{id}`、`GET /splits/{id}/export` |
| 配置校验 | `POST /training/validation` |
| 实验及输入版本 | `GET /validated-experiments/{id}?version=N` |
| 划分成员分页 | `GET /validated-experiments/{id}/members?partition=train&page=1` |
| 队列与资源 | `GET /scheduler/queue`、`GET /scheduler/resources` |
| 停止 | `POST /validated-experiments/{id}/stop` |
| 日志、结果、指标和产物 | `GET /experiments/{id}/logs`、`/results`、`/metrics`、`/artifacts` |

调度器在后端进程内直接更新执行状态，不提供远程 worker HTTP 接口。
