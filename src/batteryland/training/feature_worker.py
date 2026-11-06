"""Standalone BatteryLife embedding worker, executed in the training environment."""

from __future__ import annotations

import ast
import importlib
import inspect
import json
import pickle
import random
import sys
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pandas as pd
import torch


def curve_reader(root: Path, length: int, loader_path: Path | None = None):
    """Reuse the two upstream preprocessing methods without importing training/label services."""
    path = loader_path or root / "data_provider/data_loader.py"
    if loader_path is None and not path.is_file():
        path = root / "components/datafactory/BatteryLifeDataset.py"
    tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
    names = {"get_charge_discharge_curves", "resample_charge_discharge_curves"}
    dataset = next(
        (
            node
            for node in tree.body
            if isinstance(node, ast.ClassDef)
            and names
            <= {method.name for method in node.body if isinstance(method, ast.FunctionDef)}
        ),
        None,
    )
    if dataset is None:
        raise ValueError("模型数据加载器缺少曲线预处理方法")
    methods = [
        node for node in dataset.body if isinstance(node, ast.FunctionDef) and node.name in names
    ]
    if {node.name for node in methods} != names:
        raise ValueError("BatteryLife 数据加载器缺少曲线预处理方法")
    namespace = {"np": np}
    for method in methods:
        exec(compile(ast.Module(body=[method], type_ignores=[]), str(path), "exec"), namespace)
    reader_type = type("CurveReader", (), {name: namespace[name] for name in names})
    reader = reader_type()
    reader.charge_discharge_len = length
    return reader


def input_curves(path: Path, reader, early_cycles: int):
    with path.open("rb") as stream:
        battery = pickle.load(stream)  # trusted, indexed BatteryLand files
    cycles = battery.get("cycle_data")
    if not isinstance(cycles, (list, tuple)) or not cycles:
        raise ValueError("没有有效的 cycle_data")
    if path.name.startswith("RWTH"):
        nominal = 1.85
    elif path.name.startswith("SNL_18650_NCA_25C_20-80"):
        nominal = 3.2
    else:
        nominal = float(battery["nominal_capacity_in_Ah"])
    if not np.isfinite(nominal) or nominal <= 0:
        raise ValueError("额定容量必须是有限正数")
    keys = [
        "current_in_A",
        "voltage_in_V",
        "charge_capacity_in_Ah",
        "discharge_capacity_in_Ah",
        "time_in_s",
    ]
    parts = []
    for index, cycle in enumerate(cycles[:early_cycles]):
        frame = pd.DataFrame({key: cycle[key] for key in keys})
        frame["cycle_number"] = index + 1
        frame.loc[frame["charge_capacity_in_Ah"] < 0] = np.nan
        frame.loc[frame["discharge_capacity_in_Ah"] < 0] = np.nan
        parts.append(frame.bfill())
    curves = reader.get_charge_discharge_curves(path.name, pd.concat(parts), early_cycles, nominal)
    if (
        curves.shape != (early_cycles, 3, reader.charge_discharge_len)
        or not np.isfinite(curves).all()
    ):
        raise ValueError("预处理产生无效的曲线或张量形状")
    return (
        curves.astype(np.float32),
        min(len(cycles), early_cycles),
        str(battery.get("cell_id", path.stem)),
        nominal,
    )


def extract_file(
    model,
    reader,
    path: Path,
    dataset: str,
    parameters: dict,
    stride: int,
    batch_size: int,
    device: str,
):
    early = parameters["early_cycle_threshold"]
    curves, available, cell_id, nominal = input_curves(path, reader, early)
    ends = list(range(parameters["seq_len"], available + 1, stride))
    if not ends:
        raise ValueError("真实可用循环数少于模型要求的 seq_len")
    rows = []
    for offset in range(0, len(ends), batch_size):
        batch_ends = ends[offset : offset + batch_size]
        masks = np.arange(early)[None, :] < np.asarray(batch_ends)[:, None]
        inputs = np.repeat(curves[None, ...], len(batch_ends), axis=0)
        inputs *= masks[:, :, None, None]
        with torch.inference_mode():
            output = model(
                torch.from_numpy(inputs).to(device),
                torch.from_numpy(masks.astype(np.float32)).to(device),
                return_embedding=True,
            )
        if not isinstance(output, (tuple, list)) or len(output) != 2:
            raise ValueError("模型必须返回 (prediction, embedding)")
        embedding = output[1]
        if (
            not isinstance(embedding, torch.Tensor)
            or embedding.ndim != 2
            or embedding.shape[0] != len(batch_ends)
            or embedding.shape[1] < 2
        ):
            raise ValueError("模型 embedding 必须是 [batch, dimensions]，且至少有两个维度")
        values = embedding.detach().float().cpu().numpy()
        if not np.isfinite(values).all():
            raise ValueError("模型表示包含 NaN 或无穷值")
        for end, vector in zip(batch_ends, values, strict=True):
            uid = f"{dataset}/{path.name}"
            rows.append(
                {
                    "dataset": dataset,
                    "cell_uid": uid,
                    "cell_id": cell_id,
                    "file": path.name,
                    "sample_uid": f"{uid}/1-{end}",
                    "cycle_number": end,
                    "window_start": 1,
                    "window_end": end,
                    "nominal_capacity_Ah": nominal,
                    **{
                        f"embedding_{index:04d}": float(value) for index, value in enumerate(vector)
                    },
                }
            )
    return pd.DataFrame(rows)


def build_model(model_type: str, parameters: dict, module: str | None = None):
    constructor = importlib.import_module(module or f"models.{model_type}").Model
    signature = inspect.signature(constructor).parameters
    if not {"configs", "args", "config", "cfg"}.intersection(signature):
        return constructor(
            **{key: value for key, value in parameters.items() if key in signature}
        ).float()
    options = {}
    if model_type.casefold() == "cptransformer_adapter_lora":
        targets = parameters.get("LoRA_target_modules")
        options = {
            "enable_lora": int(parameters.get("use_LoRA", 0) or 0) == 1,
            "lora_rank": int(parameters.get("LoRA_r", 8)),
            "lora_alpha": int(parameters.get("LoRA_alpha", 8)),
            "lora_target_modules": targets.split(",") if isinstance(targets, str) else targets,
            "freeze_base_model": int(parameters.get("freeze_original", 1)) == 1,
        }
    return constructor(SimpleNamespace(**parameters), **options).float()


def run(request: dict, emit) -> None:
    root = Path(request["root"]).resolve()
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    sys.path.insert(0, str(root))
    from batteryland.domain_shift.cache import save_frame

    parameters = request["parameters"]
    device = request["device"]
    if device.startswith("cuda:") and (
        not torch.cuda.is_available() or int(device.split(":")[1]) >= torch.cuda.device_count()
    ):
        raise ValueError("所选 CUDA 设备不可用")
    if request.get("weight_source") == "random":
        seed = request["initialization_seed"]
        random.seed(seed)
        np.random.seed(seed)
        torch.manual_seed(seed)
    model = build_model(request["model_type"], parameters, request.get("model_module"))
    if request.get("weight_source") != "random":
        checkpoint = Path(request["checkpoint_path"])
        if checkpoint.suffix.casefold() == ".safetensors":
            # Accelerate.save_model, used by completed experiments, defaults to this format.
            from safetensors.torch import load_file

            state = load_file(str(checkpoint), device="cpu")
        else:
            state = torch.load(checkpoint, map_location="cpu", weights_only=True)
        if isinstance(state, dict):
            state = state.get("state_dict", state.get("model_state_dict", state))
        if not isinstance(state, dict) or not state:
            raise ValueError("权重必须是完整的 PyTorch state_dict")
        # Strip only a shared wrapper prefix; checkpoint loading remains strict.
        for prefix in ("module.", "model."):
            if all(key.startswith(prefix) for key in state):
                state = {key[len(prefix) :]: value for key, value in state.items()}
        model.load_state_dict(state, strict=True)
    model.to(device).eval()
    reader = curve_reader(
        root,
        parameters["charge_discharge_length"],
        Path(request["loader_path"]) if request.get("loader_path") else None,
    )
    built, failed = 0, []
    for index, item in enumerate(request["files"]):
        try:
            frame = extract_file(
                model,
                reader,
                Path(item["path"]),
                item["dataset"],
                parameters,
                request["stride"],
                request["batch_size"],
                device,
            )
            target = Path(item["output"])
            save_frame(target, frame)
            built += 1
        except Exception as exc:
            failed.append(
                [item["dataset"], Path(item["path"]).name, f"{type(exc).__name__}: {exc}"]
            )
        emit(
            {
                "done": index + 1,
                "total": len(request["files"]),
                "current_file": Path(item["path"]).name,
                "built": built,
                "failed": failed,
            }
        )


def main() -> int:
    output = sys.stdout

    def emit(event):
        print(json.dumps(event, ensure_ascii=False), file=output, flush=True)

    try:
        request = json.load(sys.stdin)
        # Library progress/messages go to stderr; stdout contains only structured events.
        with redirect_stdout(sys.stderr):
            run(request, emit)
        return 0
    except Exception as exc:
        print(
            json.dumps({"error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False),
            file=output,
            flush=True,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
