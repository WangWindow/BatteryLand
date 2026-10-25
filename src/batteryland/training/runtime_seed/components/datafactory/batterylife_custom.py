"""BatteryLife data factory that consumes the split supplied for one run."""

import json
from pathlib import Path
from typing import Any, cast

from components.datafactory.BatteryLifeDataset import BatteryLifeDatasetFactory
from core.register.registryhub import R

BatteryLifeDatasetFactory = cast(Any, BatteryLifeDatasetFactory)


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate split key: {key}")
        result[key] = value
    return result


@R.dataFactory.register("BatteryLandBatteryLifeDatasetFactory")
class BatteryLandBatteryLifeDatasetFactory(BatteryLifeDatasetFactory):
    def __init__(
        self,
        dataset,
        eval_cycle_max,
        eval_cycle_min,
        root_path,
        seq_len,
        charge_discharge_len,
        early_cycle_threshold,
        weighted_loss,
        batch_size,
        num_workers=8,
        split_file=None,
    ):
        self.split_file = Path(split_file).resolve() if split_file else None
        super().__init__(
            dataset,
            eval_cycle_max,
            eval_cycle_min,
            root_path,
            seq_len,
            charge_discharge_len,
            early_cycle_threshold,
            weighted_loss,
            batch_size,
            num_workers,
        )

    def get_split_files(self, dataset):
        if self.split_file is None or not self.split_file.is_file():
            raise ValueError("BatteryLand runs require a managed split_file")
        with self.split_file.open(encoding="utf-8") as stream:
            split = json.load(stream, object_pairs_hook=_unique_object)
        if not isinstance(split, dict) or set(split) != {"dataset", "train", "val", "test"}:
            raise ValueError("Split file must contain dataset, train, val and test")
        if split["dataset"] != dataset:
            raise ValueError("Config dataset does not match the split file")
        seen = set()
        for partition in ("train", "val", "test"):
            members = split[partition]
            if not isinstance(members, list) or any(
                not isinstance(name, str) or not name.strip() for name in members
            ):
                raise ValueError(f"Split {partition} must contain file names")
            if len(members) != len(set(members)) or seen.intersection(members):
                raise ValueError("Split members must be unique across all partitions")
            seen.update(members)
        return split["train"], split["val"], split["test"]

    def read_data(self):
        unknown_test_files = set()
        original_labels = self.unseen_seen_record
        if self.flag == "test" and isinstance(original_labels, dict):
            unknown_test_files = set(self.files) - original_labels.keys()
            if unknown_test_files:
                # The upstream reader requires a label; exclude missing labels from both subgroups below.
                self.unseen_seen_record = original_labels | {
                    file_name: "seen" for file_name in unknown_test_files
                }

        try:
            data = super().read_data()
        finally:
            self.unseen_seen_record = original_labels

        if unknown_test_files:
            seen_unseen_ids = data[7]
            file_names = data[8]
            for index, file_name in enumerate(file_names):
                if file_name in unknown_test_files:
                    seen_unseen_ids[index] = -1
        return data
