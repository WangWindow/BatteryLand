import json

from batteryland.common.errors import DomainError
from batteryland.datasets.service import ResourceService
from batteryland.datasets.splits import SplitService
from batteryland.db.contracts import Record
from batteryland.experiments.templates import ConfigurationService


class BundledImportService:
    def __init__(
        self, resources: ResourceService, splits: SplitService, templates: ConfigurationService
    ) -> None:
        self.resources, self.splits, self.templates = resources, splits, templates

    def import_catalog(self, source_id: str, catalog: Record) -> Record:
        batteries = self.resources.import_batteries(source_id, catalog["batteries"])
        # Each document is atomic; a retry resumes an interrupted multi-document import.
        existing_splits: Record = {}
        page = 1
        while True:
            batch = self.splits.list(source_id, None, page, 200)
            existing_splits.update({item["name"]: item for item in batch["items"]})
            if page * 200 >= batch["total"]:
                break
            page += 1
        split_counts = {"imported": 0, "existing": 0}
        for value in catalog["splits"]:
            previous = existing_splits.get(value["dataset"])
            if previous:
                if self.splits.export(previous["id"]) != value:
                    raise DomainError("conflict", "Existing split differs from bundled content")
                split_counts["existing"] += 1
            else:
                self.splits.import_document(source_id, json.dumps(value).encode())
                split_counts["imported"] += 1
        existing_templates: Record = {}
        page = 1
        while True:
            batch = self.templates.list(None, page, 200)
            existing_templates.update({item["name"]: item for item in batch["items"]})
            if page * 200 >= batch["total"]:
                break
            page += 1
        template_counts = {"imported": 0, "existing": 0}
        for value in catalog["templates"]:
            previous = existing_templates.get(value["name"])
            if previous:
                if self.templates.get(previous["id"])["native_config"] != value["native_config"]:
                    raise DomainError("conflict", "Existing template differs from bundled content")
                template_counts["existing"] += 1
            else:
                self.templates.create(value["name"], value["native_config"])
                template_counts["imported"] += 1
        return {"batteries": batteries, "splits": split_counts, "templates": template_counts}
