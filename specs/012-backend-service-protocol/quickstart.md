# 单后端 API 调用顺序

启动 `./scripts/run.sh --services-only` 后，仅使用 `http://127.0.0.1:8000`。
以下示例使用 Python 标准库，不需要另装客户端包；配置与划分从现有文件读取。

```python
import json
from pathlib import Path
from urllib.request import Request, urlopen

base = "http://127.0.0.1:8000/api/v1"

def post(path, body):
    request = Request(
        base + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request) as response:
        return json.load(response)["data"]

provider = Path("src/deeplatform")
config = (provider / "configs/calce_seed2021.yaml").read_text()
split = (provider / "datasets/batteryLife/data_split/CALCE.json").read_text()
validation = post("/training/validation", {"config_text": config, "split_text": split})
if not validation["execution_supported"]:
    raise RuntimeError(validation["limitations"])
experiment = post("/validated-experiments", {
    "name": "CALCE example",
    "config_text": config,
    "split_text": split,
    "receipt": validation["receipt"],
})
post(f"/validated-experiments/{experiment['id']}/submit", {})
print(experiment["id"])
```

校验收据绑定配置和划分的原文哈希，有效期为一小时。保存草稿之后可用带
`expected_revision` 的 `PUT /validated-experiments/{id}` 更新；首次提交后输入冻结。
同一实验 ID 的重复提交不会再次启动；终态后再次训练须创建新 ID。

后续可查询：

| 用途 | 接口 |
| --- | --- |
| 实验及输入版本 | `GET /validated-experiments/{id}?version=N` |
| 划分成员分页 | `GET /validated-experiments/{id}/members?partition=train&page=1` |
| 固定集合与命名划分 | `GET /data-sources`、`GET /catalog/named-groups` |
| 队列与资源 | `GET /queue`、`GET /scheduler/resources` |
| 停止 | `POST /experiments/{id}/stop` |
| 日志、结果、指标和产物 | `GET /experiments/{id}/logs`、`/results`、`/metrics`、`/artifacts` |

浏览器使用相同的公开接口；`/worker/*` 属于带令牌的内部兼容接口，不是前端契约。
