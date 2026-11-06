"""Resolve BatteryLife architectures or saved weights and cache their embeddings."""

import ast
import hashlib
import json
import math
import subprocess
import tempfile
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

import pandas as pd

from batteryland.common.errors import DomainError
from batteryland.common.storage import ManagedArtifacts, contained_path
from batteryland.config import Settings
from batteryland.db.contracts import Record, UnitOfWorkFactory
from batteryland.training.paths import experiment_directory
from batteryland.training.runtime import TrainingRuntime

from . import cache, data

_INPUT_DEFAULTS = {"seq_len": 20, "early_cycle_threshold": 100, "charge_discharge_length": 300}
# Same CPMLP defaults used by the platform's experiment editor.
_MODEL_DEFAULTS = {
    "cpmlp": {"d_ff": 256, "d_model": 128, "dropout": 0.0, "e_layers": 4, "d_layers": 2},
}
_POSITIVE_INTEGERS = {
    "seq_len",
    "early_cycle_threshold",
    "charge_discharge_length",
    "charge_discharge_len",
    "d_model",
    "d_ff",
    "n_heads",
    "enc_in",
    "dec_in",
    "c_out",
    "patch_len",
    "stride",
}
_NONNEGATIVE_INTEGERS = {"e_layers", "d_layers", "num_layers"}
_WEIGHT_SUFFIXES = {".pt", ".pth", ".bin", ".safetensors"}


class ModelFeatureExtractor:
    def __init__(self, settings: Settings, units: UnitOfWorkFactory) -> None:
        self.settings = settings
        self.units = units
        self.artifacts = ManagedArtifacts(settings.data_dir)
        self.runtime = TrainingRuntime(settings.training_python)

    def resolve(self, selection: Record) -> Record:
        if "model_type" in selection:
            seed = selection.get("initialization_seed", 42)
            if type(seed) is not int or not 0 <= seed <= 99999:
                raise DomainError("invalid_input", "初始化种子必须是 0 到 99999 的整数")
            return self._specification(
                selection["model_type"], dict(selection["parameters"]), selection
            ) | {
                "experiment_name": None,
                "checkpoint_name": "随机初始化",
            }
        with self.units() as unit:
            experiment = unit.experiments.get(selection["experiment_id"])
            value = unit.validated_inputs.get(selection["experiment_id"])
            checkpoint = unit.artifacts.get(selection["checkpoint_id"])
        if experiment["state"] != "succeeded":
            raise DomainError("invalid_input", "模型特征分析需要选择已完成实验")
        if (
            checkpoint["experiment_id"] != experiment["id"]
            or checkpoint["kind"] != "checkpoint"
            or checkpoint["is_directory"]
            or checkpoint["availability"] != "available"
        ):
            raise DomainError("invalid_input", "所选权重必须是该实验中可用的完整权重文件")
        if Path(checkpoint["name"]).suffix.casefold() not in _WEIGHT_SUFFIXES:
            raise DomainError(
                "unsupported_capability", "请选择完整的 .pt、.pth、.bin 或 .safetensors 模型权重"
            )
        config = value["config"]
        model = config.get("model", {})
        params = model.get("params", {})
        params = params.get("configs", params)
        parameters = dict(config.get("datafactory", {}).get("params", {})) | dict(params)
        path = self.artifacts.resolve(checkpoint["relative_key"])
        if any(path.parent.glob("*.index.json")) and "-of-" in path.stem:
            raise DomainError(
                "unsupported_capability", "此文件为分片权重，请使用合并后的完整模型权重"
            )
        try:
            with path.open("rb") as stream:
                weight_hash = hashlib.file_digest(stream, "sha256").hexdigest()
        except OSError as exc:
            raise DomainError("storage_corrupt", "登记的权重文件无法读取，请检查实验产物") from exc
        if checkpoint["sha256"] != weight_hash:
            raise DomainError("storage_corrupt", "权重文件与登记摘要不一致")
        return self._specification(
            str(model.get("type", "")), parameters, selection, weight_hash
        ) | {
            "checkpoint_path": str(path),
            "experiment_name": experiment["name"],
            "checkpoint_name": checkpoint["name"],
        }

    def _root(self) -> Path:
        # The in-project provider is also the source used to train saved experiments.
        root = self.settings.batterylife_root or self.settings.provider_root
        if not self._model_directory(root).is_dir() or not self._loader_path(root).is_file():
            raise DomainError(
                "integration_precondition_failed",
                f"未找到模型源码或曲线加载器：{root}；请检查 BATTERYLAND_PROVIDER_ROOT，"
                "或配置 BATTERYLAND_BATTERYLIFE_ROOT 为 BatteryLife 源码根目录",
            )
        return root.resolve()

    @staticmethod
    def _model_directory(root: Path) -> Path:
        return root / "models" if (root / "models").is_dir() else root / "components/models"

    @staticmethod
    def _loader_path(root: Path) -> Path:
        upstream = root / "data_provider/data_loader.py"
        return (
            upstream
            if upstream.is_file()
            else root / "components/datafactory/BatteryLifeDataset.py"
        )

    @staticmethod
    def _model_tree(model_path: Path) -> ast.Module:
        tree = ast.parse(model_path.read_text(encoding="utf-8-sig"))
        model_class = next(
            (node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "Model"),
            None,
        )
        forward = (
            next(
                (
                    node
                    for node in model_class.body
                    if isinstance(node, ast.FunctionDef) and node.name == "forward"
                ),
                None,
            )
            if model_class
            else None
        )
        if (
            forward is None
            or "return_embedding" not in {arg.arg for arg in forward.args.args}
            or len(forward.args.args) < 3
        ):
            raise DomainError(
                "unsupported_capability", "所选模型不支持 BatteryLife 的 return_embedding 接口"
            )
        required_args = len(forward.args.args) - len(forward.args.defaults) - 1
        if required_args > 2:
            raise DomainError("unsupported_capability", "所选模型的输入接口需要单独适配")
        return tree

    def _specification(
        self, model_type: str, parameters: Record, selection: Record, weight_hash: str | None = None
    ) -> Record:
        if selection.get("layer", "embedding") != "embedding":
            raise DomainError("invalid_input", "当前支持模型原生 embedding 特征层")
        if "charge_discharge_len" in parameters:
            parameters.setdefault("charge_discharge_length", parameters["charge_discharge_len"])
        if model_type.casefold() == "cptransformer" and any(
            parameters.get(key) in (1, True, "1") for key in ("use_LoRA", "use_adapter")
        ):
            model_type = "CPTransformer_adapter_lora"
        root = self._root()
        model_directory = self._model_directory(root)
        candidates = [
            path
            for path in model_directory.glob("*.py")
            if path.stem.casefold() == model_type.casefold()
        ]
        if len(candidates) != 1:
            raise DomainError(
                "unsupported_capability", f"BatteryLife 源码中未找到模型 {model_type}"
            )
        model_path = candidates[0]
        tree = self._model_tree(model_path)
        defaults, required = self._model_parameters(root, model_path.stem, tree)
        if "model_type" in selection:
            parameters = defaults | parameters
        parameters.setdefault("charge_discharge_len", parameters.get("charge_discharge_length"))
        self._validate_parameters(parameters, defaults, required)
        for key in ("seq_len", "early_cycle_threshold", "charge_discharge_length"):
            if type(parameters.get(key)) is not int or parameters[key] <= 0:
                raise DomainError("invalid_input", f"模型配置缺少有效的 {key}")
        if (
            parameters["seq_len"] > parameters["early_cycle_threshold"]
            or parameters["charge_discharge_length"] % 2
        ):
            raise DomainError("invalid_input", "窗口长度或曲线重采样长度无效")
        loader = self._loader_path(root)
        module = ".".join(model_path.relative_to(root).with_suffix("").parts)
        digest = hashlib.sha256()
        for source in sorted(
            [
                *model_directory.glob("*.py"),
                *(root / "layers").rglob("*.py"),
                *(root / "components/layers").rglob("*.py"),
                *(root / "utils").rglob("*.py"),
                *(root / "core/register").rglob("*.py"),
                loader,
                Path(__file__).resolve(),
                Path(cache.__file__).resolve(),
                self.worker_path(),
            ]
        ):
            digest.update(source.name.encode() + b"\0" + source.read_bytes())
        identity = {
            "model_type": model_path.stem,
            "model_module": module,
            "parameters": parameters,
            "weight_sha256": weight_hash,
            "source_sha256": digest.hexdigest(),
            "layer": "embedding",
            "weight_source": "checkpoint" if weight_hash else "random",
            "initialization_seed": None
            if weight_hash
            else selection.get("initialization_seed", 42),
        }
        cache_key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        return identity | {"root": str(root), "loader_path": str(loader), "cache_key": cache_key}

    @staticmethod
    def _argument_defaults(root: Path) -> Record:
        defaults = {}
        # Read literal argparse defaults without importing or executing training code.
        for path in sorted(root.glob("run*.py")) + [root / "main.py"]:
            if not path.is_file():
                continue
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8-sig"))):
                if (
                    not isinstance(node, ast.Call)
                    or not isinstance(node.func, ast.Attribute)
                    or node.func.attr != "add_argument"
                ):
                    continue
                keywords = {item.arg: item.value for item in node.keywords}
                flags = [
                    item.value
                    for item in node.args
                    if isinstance(item, ast.Constant)
                    and isinstance(item.value, str)
                    and item.value.startswith("--")
                ]
                if flags and "default" in keywords:
                    try:
                        key = (
                            ast.literal_eval(keywords["dest"])
                            if "dest" in keywords
                            else flags[0][2:].replace("-", "_")
                        )
                        defaults[key] = ast.literal_eval(keywords["default"])
                    except ValueError, TypeError:
                        continue
        return defaults

    def _model_parameters(
        self, root: Path, model_type: str, tree: ast.Module
    ) -> tuple[Record, list[str]]:
        arguments = self._argument_defaults(root)
        defaults = _INPUT_DEFAULTS | _MODEL_DEFAULTS.get(model_type.casefold(), {})
        defaults |= {
            key: value
            for key, value in arguments.items()
            if value is not None or key not in defaults
        }
        if "charge_discharge_len" in defaults:
            defaults["charge_discharge_length"] = defaults["charge_discharge_len"]
        references = set(_INPUT_DEFAULTS)
        optional = {key for key, value in arguments.items() if value is None}
        config_names = {"configs", "args", "config", "cfg"}
        model_class = next(
            node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "Model"
        )
        constructor = next(
            (
                node
                for node in model_class.body
                if isinstance(node, ast.FunctionDef) and node.name == "__init__"
            ),
            None,
        )
        if constructor is not None:
            positional = [*constructor.args.posonlyargs, *constructor.args.args][1:]
            if not any(arg.arg in config_names for arg in positional):
                # DeepPlatform models take named parameters instead of a config namespace.
                references.update(arg.arg for arg in [*positional, *constructor.args.kwonlyargs])
                positional_defaults = constructor.args.defaults
                literal_defaults = [
                    *zip(
                        positional[len(positional) - len(positional_defaults) :],
                        positional_defaults,
                        strict=True,
                    ),
                    *zip(constructor.args.kwonlyargs, constructor.args.kw_defaults, strict=True),
                ]
                for arg, value_node in literal_defaults:
                    if value_node is None:
                        continue
                    try:
                        value = ast.literal_eval(value_node)
                    except ValueError, TypeError:
                        continue
                    defaults[arg.arg] = value
                    if value is None:
                        optional.add(arg.arg)
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and (
                isinstance(node.value, ast.Name)
                and node.value.id in config_names
                or isinstance(node.value, ast.Attribute)
                and node.value.attr in config_names
                and isinstance(node.value.value, ast.Name)
                and node.value.value.id == "self"
            ):
                references.add(node.attr)
            elif (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "getattr"
                and len(node.args) >= 2
                and isinstance(node.args[0], ast.Name)
                and node.args[0].id in config_names
                and isinstance(node.args[1], ast.Constant)
                and isinstance(node.args[1].value, str)
            ):
                key = node.args[1].value
                references.add(key)
                if len(node.args) == 3:
                    try:
                        value = ast.literal_eval(node.args[2])
                    except ValueError, TypeError:
                        continue
                    defaults.setdefault(key, value)
                    if defaults[key] is None:
                        optional.add(key)
        parameters = {key: defaults.get(key) for key in sorted(references)}
        numeric = (
            _POSITIVE_INTEGERS
            | _NONNEGATIVE_INTEGERS
            | {key for key in references if "dropout" in key}
        )
        required = sorted(references - (optional - numeric))
        return parameters, required

    @staticmethod
    def _validate_parameters(parameters: Record, defaults: Record, required: list[str]) -> None:
        missing = [key for key in required if parameters.get(key) is None]
        if missing:
            raise DomainError("invalid_input", "模型参数缺失或为空：" + "、".join(missing))
        errors = []
        for key, default in defaults.items():
            value = parameters.get(key)
            if value is None:
                continue
            if "dropout" in key:
                if (
                    type(value) not in {int, float}
                    or not math.isfinite(value)
                    or not 0 <= value <= 1
                ):
                    errors.append(f"{key} 必须是 0 到 1 的数值")
            elif key in _POSITIVE_INTEGERS:
                if type(value) is not int or value <= 0:
                    errors.append(f"{key} 必须是正整数")
            elif key in _NONNEGATIVE_INTEGERS:
                if type(value) is not int or value < 0:
                    errors.append(f"{key} 必须是非负整数")
            elif default is not None:
                expected = type(default)
                valid = (
                    type(value) in {int, float} if expected is float else type(value) is expected
                )
                if not valid:
                    errors.append(f"{key} 类型无效，应为 {expected.__name__}")
        if errors:
            raise DomainError("invalid_input", "模型参数无效：" + "；".join(errors))

    def architectures(self) -> list[Record]:
        root = self._root()
        options = []
        for path in sorted(self._model_directory(root).glob("*.py")):
            if path.name.startswith("_"):
                continue
            parameters = dict(_INPUT_DEFAULTS)
            required = list(_INPUT_DEFAULTS)
            reason = None
            try:
                tree = self._model_tree(path)
                parameters, required = self._model_parameters(root, path.stem, tree)
            except DomainError as exc:
                reason = exc.message
            options.append(
                {
                    "model_type": path.stem,
                    "parameters": parameters,
                    "required_parameters": required,
                    "supported": reason is None,
                    "reason": reason,
                }
            )
        return options

    @staticmethod
    def worker_path() -> Path:
        return Path(__file__).resolve().parents[1] / "training/feature_worker.py"

    def models(self) -> list[Record]:
        with self.units() as unit:
            experiments = unit.experiments.list_experiments({"state": "succeeded"}, 1, 200)["items"]
            candidates = []
            for item in experiments:
                try:
                    config = unit.validated_inputs.get(item["id"])["config"]
                    item = item | {
                        "model_type": config.get("model", {}).get("type", item.get("model_type"))
                    }
                except DomainError:
                    pass
                artifacts = unit.artifacts.for_experiment(item["id"])
                for checkpoint in self._discover_checkpoints(item["id"], artifacts):
                    artifacts.append(unit.artifacts.upsert(checkpoint))
                candidates.append((item, artifacts))
        options = []
        for experiment, artifacts in candidates:
            weights = [
                item
                for item in artifacts
                if item["kind"] == "checkpoint"
                and not item["is_directory"]
                and item["availability"] == "available"
                and Path(item["name"]).suffix.casefold() in _WEIGHT_SUFFIXES
            ]
            checkpoints = []
            model_type = experiment.get("model_type") or ""
            for weight in weights:
                reason = None
                try:
                    specification = self.resolve(
                        {"experiment_id": experiment["id"], "checkpoint_id": weight["id"]}
                    )
                    model_type = specification["model_type"]
                except DomainError as exc:
                    reason = exc.message
                checkpoints.append(
                    {
                        "id": weight["id"],
                        "name": weight["name"],
                        "supported": reason is None,
                        "reason": reason,
                        **self._checkpoint_location(experiment["id"], weight["relative_key"]),
                    }
                )
            options.append(
                {
                    "experiment_id": experiment["id"],
                    "name": experiment["name"],
                    "model_type": model_type,
                    "checkpoints": checkpoints,
                }
            )
        return options

    def _discover_checkpoints(self, experiment_id: str, registered: list[Record]) -> list[Record]:
        """Recover unregistered weights only from this experiment's run checkpoint folders."""
        storage = self.settings.data_dir.resolve()
        if (storage / "experiments").is_symlink():
            return []
        directory = experiment_directory(storage / "experiments", experiment_id)
        runs = directory / "runs"
        if runs.is_symlink() or not runs.is_dir():
            return []
        known = {item["relative_key"].replace("\\", "/") for item in registered}
        discovered = []
        for run in sorted(runs.iterdir(), reverse=True):
            checkpoint_dir = run / "checkpoint"
            if run.is_symlink() or checkpoint_dir.is_symlink() or not checkpoint_dir.is_dir():
                continue
            for path in sorted(checkpoint_dir.rglob("*")):
                if (
                    not path.is_file()
                    or path.suffix.casefold() not in _WEIGHT_SUFFIXES
                    or any(
                        parent.is_symlink() for parent in (path, *path.parents) if parent != storage
                    )
                    or not path.resolve().is_relative_to(directory)
                ):
                    continue
                key = path.relative_to(storage).as_posix()
                if key in known:
                    continue
                with path.open("rb") as stream:
                    checksum = hashlib.file_digest(stream, "sha256").hexdigest()
                discovered.append(
                    {
                        "id": str(
                            uuid5(NAMESPACE_URL, f"batteryland:checkpoint:{experiment_id}:{key}")
                        ),
                        "experiment_id": experiment_id,
                        "component_id": None,
                        "origin": "execution",
                        "kind": "checkpoint",
                        "name": path.name,
                        "relative_key": key,
                        "sha256": checksum,
                        "size": path.stat().st_size,
                        "availability": "available",
                        "is_directory": False,
                    }
                )
        return discovered

    def _checkpoint_location(self, experiment_id: str, key: str) -> Record:
        key = key.replace("\\", "/")
        parts = Path(key).parts
        run_id = (
            parts[3]
            if len(parts) >= 6
            and parts[:3] == ("experiments", experiment_id, "runs")
            and parts[4] == "checkpoint"
            else None
        )
        # Keep the recorded location visible even if the weight file is currently missing.
        path = contained_path(self.settings.data_dir, key)
        project = Path(__file__).resolve().parents[3]
        relative = path.relative_to(project) if path.is_relative_to(project) else path
        return {"run_id": run_id, "relative_key": key, "relative_path": relative.as_posix()}

    def cache_dir(self, specification: Record) -> Path:
        return self.settings.data_dir / "domain-shift/model-features" / specification["cache_key"]

    def build(
        self,
        specification: Record,
        datasets: dict[str, list[Path]],
        selected: list[str],
        stride: int,
        batch_size: int,
        device: str,
        progress,
    ) -> Record:
        cache_dir = self.cache_dir(specification)
        files = [
            {
                "dataset": name,
                "path": str(path),
                "output": str(data.cache_file(cache_dir, name, path, stride)),
            }
            for name in selected
            for path in datasets.get(name, [])
            if not data.cache_usable(data.cache_file(cache_dir, name, path, stride))
        ]
        if not files:
            return {"built": 0, "failed": [], "total": 0}
        request = specification | {
            "files": files,
            "stride": stride,
            "batch_size": batch_size,
            "device": device,
        }
        environment = self.runtime.environment(
            {"PYTHONUNBUFFERED": "1", "PYTHONDONTWRITEBYTECODE": "1"}
        )
        result = {"built": 0, "failed": [], "total": len(files)}
        with tempfile.TemporaryFile(mode="w+", encoding="utf-8") as errors:
            process = subprocess.Popen(
                [str(self.runtime.python), str(self.worker_path())],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=errors,
                text=True,
                encoding="utf-8",
                env=environment,
            )
            try:
                if process.stdin is None or process.stdout is None:
                    raise RuntimeError("模型特征提取进程无法通信")
                process.stdin.write(json.dumps(request))
                process.stdin.close()
                for line in process.stdout:
                    event = json.loads(line)
                    if "error" in event:
                        raise DomainError("integration_precondition_failed", event["error"])
                    result = {
                        "built": event["built"],
                        "failed": event["failed"],
                        "total": event["total"],
                    }
                    progress(event["done"], event["total"], event["current_file"])
                if process.wait() != 0:
                    errors.seek(0)
                    raise DomainError(
                        "integration_precondition_failed",
                        "模型特征提取失败：" + errors.read()[-2000:],
                    )
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait()
        return result

    def load(
        self,
        specification: Record,
        datasets: dict[str, list[Path]],
        selected: list[str],
        stride: int,
    ) -> pd.DataFrame:
        return data.load_features(datasets, selected, stride, self.cache_dir(specification))
