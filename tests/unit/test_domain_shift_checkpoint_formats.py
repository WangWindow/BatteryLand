"""Saved model formats and PEFT construction must match the training architecture."""

from types import SimpleNamespace

import pytest

from batteryland.domain_shift.model_features import ModelFeatureExtractor


def test_model_choices_exclude_configuration_files_misclassified_as_checkpoints(
    tmp_path, monkeypatch
):
    experiment = {"id": "experiment", "name": "Pretrained battery model"}
    artifacts = [
        {
            "id": name,
            "name": name,
            "relative_key": name,
            "kind": "checkpoint",
            "availability": "available",
            "is_directory": False,
        }
        for name in (
            "args.json",
            "model.safetensors",
            "pytorch_model.bin",
            "model.pth",
            "notes.txt",
        )
    ]

    class Unit:
        experiments = SimpleNamespace(list_experiments=lambda *_: {"items": [experiment]})
        artifacts = SimpleNamespace(for_experiment=lambda _: artifacts)
        validated_inputs = SimpleNamespace(
            get=lambda _: {"config": {"model": {"type": "CPTransformer"}}}
        )

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    extractor = ModelFeatureExtractor(
        SimpleNamespace(data_dir=tmp_path, training_python=tmp_path / "python"), Unit
    )
    monkeypatch.setattr(extractor, "resolve", lambda _: {"model_type": "CPTransformer"})
    assert [item["name"] for item in extractor.models()[0]["checkpoints"]] == [
        "model.safetensors",
        "pytorch_model.bin",
        "model.pth",
    ]


def test_saved_lora_flags_construct_the_correct_backbone(monkeypatch):
    torch = pytest.importorskip("torch")
    from batteryland.training import feature_worker

    class PeftModel(torch.nn.Module):
        def __init__(
            self,
            configs,
            enable_lora=False,
            lora_rank=8,
            lora_alpha=8,
            lora_target_modules=None,
            freeze_base_model=True,
        ):
            super().__init__()
            self.register_buffer("backbone", torch.tensor([2.0]))
            if enable_lora:
                self.register_buffer("lora_delta", torch.tensor([lora_rank * lora_alpha]))
            self.targets = lora_target_modules
            self.frozen = freeze_base_model

        def forward(self):
            return self.backbone + getattr(self, "lora_delta", 0)

    monkeypatch.setattr(
        feature_worker.importlib, "import_module", lambda _: SimpleNamespace(Model=PeftModel)
    )
    model = feature_worker.build_model(
        "CPTransformer_adapter_lora",
        {
            "use_LoRA": 1,
            "LoRA_r": 4,
            "LoRA_alpha": 2,
            "LoRA_target_modules": "query,value",
            "freeze_original": 0,
        },
    )
    assert model().item() == 10
    assert model.targets == ["query", "value"]
    assert model.frozen is False
    assert "lora_delta" in model.state_dict()
