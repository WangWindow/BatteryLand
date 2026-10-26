# 单后端 API 调用顺序

启动 `./scripts/run.sh --services-only` 后，仅使用 `http://127.0.0.1:8000`。浏览器和外部
调用方使用同一组公开接口。示例使用目录中已索引的 CALCE 训练数据集，再校验、保存并提交
一个新实验。内置、导入和新建划分都使用相同目录；只有 `execution_ready` 为 `true` 的条目
可以用于训练。

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
datasets = request("GET", "/splits", query={"page_size": 200})["items"]
split = next(
    item
    for item in datasets
    if item["name"] == config["datafactory"]["params"]["dataset"]
    and item["execution_ready"]
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
| 浏览训练数据集 | `GET /splits`、`GET /splits/{id}`、`GET /splits/{id}/members` |
| 创建、导入、更新或导出数据集 | `POST /splits`、`POST /splits/import/preview`、`POST /splits/import`、`PUT /splits/{id}`、`GET /splits/{id}/export` |
| 配置校验 | `POST /training/validation` |
| 实验及输入版本 | `GET /validated-experiments/{id}?version=N` |
| 划分成员分页 | `GET /validated-experiments/{id}/members?partition=train&page=1` |
| 队列与资源 | `GET /scheduler/queue`、`GET /scheduler/resources` |
| 停止 | `POST /validated-experiments/{id}/stop` |
| 日志、结果、指标和产物 | `GET /experiments/{id}/logs`、`/results`、`/metrics`、`/artifacts` |

调度器在后端进程内直接更新执行状态，不提供远程 worker HTTP 接口。

成员接口支持 `partition=train|val|test`、分页参数以及可选的 `q` 文件名/相对路径搜索；数据集
详情同时返回解析问题，供界面按分区突出显示无法匹配或不可用的文件。
