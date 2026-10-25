import csv
import io
import json

from batteryland.analytics.comparison import compare_results
from batteryland.analytics.contracts import ChartBuilder, DifferenceAnalyzer
from batteryland.common.errors import DomainError
from batteryland.datasets.splits import SplitService
from batteryland.db.contracts import Record, UnitOfWorkFactory
from batteryland.results.service import ResultService


class AnalysisService:
    def __init__(
        self,
        units: UnitOfWorkFactory,
        results: ResultService,
        splits: SplitService,
        differences: DifferenceAnalyzer,
        charts: ChartBuilder,
    ) -> None:
        self.units, self.results, self.splits = units, results, splits
        self.difference_provider, self.chart_provider = differences, charts

    def compare(self, request: Record) -> Record:
        identities = request["experiment_ids"]
        return compare_results(
            [self.results.get(identity) | {"experiment_id": identity} for identity in identities],
            request.get("metrics"),
            request.get("battery_ids"),
        )

    def export(self, request: Record) -> tuple[bytes, str, str]:
        data = self.compare(request)
        if request.get("format", "json") == "json":
            return (
                json.dumps(data, ensure_ascii=False, allow_nan=False).encode(),
                "application/json",
                "comparison.json",
            )
        output = io.StringIO(newline="")
        fields = [
            "record_type",
            "experiment_id",
            "stage",
            "epoch",
            "metric_name",
            "value",
            "unit",
            "granularity",
            "battery_id",
            "prediction",
            "target",
        ]
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        for row in data["metric_rows"]:
            value = dict(row)
            value["metric_name"] = value.pop("name")
            writer.writerow(value | {"record_type": "final_metric"})
        for row in data["prediction_rows"]:
            writer.writerow(row | {"record_type": "prediction"})
        return output.getvalue().encode(), "text/csv", "comparison.csv"

    def differences(self, request: Record) -> Record:
        resolved = []
        labels: set[str] = set()
        for item in request["sets"]:
            if item["label"] in labels:
                raise DomainError("invalid_input", "Set labels must be unique")
            labels.add(item["label"])
            partitions = item.get("partitions", ["train", "val", "test"])
            if len(set(partitions)) != len(partitions) or not partitions:
                raise DomainError("invalid_input", "Select unique nonempty partitions")
            with self.units() as unit:
                if item.get("split") is not None:
                    ref = item["split"]
                    split = self.splits.get(ref["id"], ref["version"])
                    ids = [identity for group in partitions for identity in split["payload"][group]]
                    batteries = unit.resources.get_batteries(ids)
                    identity = f"split:{ref['id']}:{ref['version']}:{','.join(sorted(partitions))}"
                    reference = {"split": ref, "partitions": partitions}
                    warnings: list[str] = []
                elif item.get("source_id") is not None:
                    source_id = str(item["source_id"])
                    unit.resources.get_source(source_id)
                    ids = [
                        row["id"] for row in unit.resources.list_source_batteries(source_id)
                    ]
                    batteries = unit.resources.get_batteries(ids)
                    identity = f"source:{source_id}"
                    reference = {"source_id": source_id}
                    warnings = []
                elif item.get("logical_dataset_id") is not None:
                    dataset_id = str(item["logical_dataset_id"])
                    dataset = unit.logical_datasets.get(dataset_id)
                    member_ids = list(unit.logical_datasets.battery_ids(dataset_id))
                    batteries = unit.resources.get_batteries(member_ids)
                    identity = f"logical_dataset:{dataset_id}"
                    reference = {"logical_dataset_id": dataset_id}
                    warnings = (
                        [f"{item['label']}: saved physical source data has changed"]
                        if dataset["stale"]
                        else []
                    )
                else:
                    group_name = item["named_group"]
                    unit.named_groups.get(group_name)
                    page = 1
                    members: list[Record] = []
                    while True:
                        result = unit.named_groups.members(group_name, None, page, 500)
                        members.extend(
                            row for row in result["items"] if row["partition"] in partitions
                        )
                        if page * 500 >= result["total"]:
                            break
                        page += 1
                    member_ids = list(
                        dict.fromkeys(
                            row["battery_id"]
                            for row in members
                            if row["match_status"] == "matched" and row["battery_id"]
                        )
                    )
                    batteries = unit.resources.get_batteries(member_ids)
                    resolved_ids = {battery["id"] for battery in batteries}
                    unresolved = sum(
                        row["match_status"] != "matched"
                        or not row["battery_id"]
                        or row["battery_id"] not in resolved_ids
                        for row in members
                    )
                    identity = f"group:{group_name}:{','.join(sorted(partitions))}"
                    reference = {"named_group": group_name, "partitions": partitions}
                    warnings = (
                        [f"{item['label']}: {unresolved} named-group members could not be resolved"]
                        if unresolved
                        else []
                    )
            resolved.append(
                {
                    "id": identity,
                    "label": item["label"],
                    **reference,
                    "batteries": batteries,
                    "warnings": warnings,
                }
            )
        return self.difference_provider.compare(
            resolved, request["analysis_kind"], request.get("category")
        )

    def charts(self, request: Record) -> Record:
        kind = request["chart_type"]
        difference_kinds = {
            "set_count_bar": "counts",
            "overlap_bar": "overlap",
            "category_bar": "category_distribution",
        }
        if kind in difference_kinds:
            if not request.get("sets"):
                raise DomainError("invalid_input", "This chart requires sets")
            data = self.differences(request | {"analysis_kind": difference_kinds[kind]})
        elif kind in {"metric_bar", "epoch_line", "prediction_scatter"}:
            if not request.get("experiment_ids"):
                raise DomainError("invalid_input", "This chart requires experiments")
            if kind != "prediction_scatter" and (
                not request.get("metric") or not request.get("stage")
            ):
                raise DomainError("invalid_input", "Metric and stage are required")
            data = self.compare(request)
            if kind == "epoch_line":
                rows: list[Record] = []
                for identity in request["experiment_ids"]:
                    page = 1
                    while True:
                        batch = self.results.metrics(
                            identity,
                            {"name": request["metric"], "stage": request["stage"]},
                            page,
                            200,
                        )
                        rows.extend(row | {"experiment_id": identity} for row in batch["items"])
                        if page * 200 >= batch["total"]:
                            break
                        page += 1
                data["metric_rows"] = rows
        else:
            raise DomainError("unsupported_capability", "Chart type is not implemented")
        return self.chart_provider.build(request, data)
