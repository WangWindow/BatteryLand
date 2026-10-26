"""Compose concrete infrastructure at the outside edge of the application."""

from dataclasses import replace

from batteryland.analytics.basic import BasicChartBuilder, BasicDifferenceAnalyzer
from batteryland.analytics.service import AnalysisService
from batteryland.common.storage import LocalSourceFiles, ManagedArtifacts
from batteryland.components.service import ArtifactService
from batteryland.config import Settings
from batteryland.datasets.catalog import FixedCatalogIndexer
from batteryland.datasets.logical import LogicalDatasetService
from batteryland.datasets.service import ResourceService
from batteryland.datasets.splits import SplitService
from batteryland.db.database import Database
from batteryland.documents.store import SQLiteDocumentStore
from batteryland.experiments.validated import ValidatedExperimentService
from batteryland.results.service import ResultService
from batteryland.results.storage import LocalResultFiles
from batteryland.scheduler.processes import RuntimeLease
from batteryland.scheduler.state import SchedulerStateService
from batteryland.training.gateway import DeeplatformGateway
from batteryland.training.runs import TrainingRunService


class Container:
    def __init__(
        self,
        settings: Settings,
    ) -> None:
        self.settings = settings
        self.lease = RuntimeLease(settings.data_dir)
        try:
            self.database = Database(settings.data_dir / "platform.sqlite")
            self.database.initialize()
            self._compose(settings)
        except BaseException:
            if hasattr(self, "database"):
                self.database.engine.dispose()
            self.lease.close()
            raise

    def _compose(self, settings: Settings) -> None:
        self.documents = SQLiteDocumentStore(self.database.unit_of_work)
        self.resources = ResourceService(
            self.database.unit_of_work, LocalSourceFiles(settings.source_roots)
        )
        self.splits = SplitService(self.database.unit_of_work, self.documents)
        self.logical_datasets = LogicalDatasetService(self.database.unit_of_work)
        self.catalog_indexer = FixedCatalogIndexer(
            settings, self.resources, self.database.unit_of_work, self.splits
        )
        training_settings = replace(settings, data_dir=settings.data_dir / "training")
        experiment_root = settings.data_dir / "experiments"
        self.provider = DeeplatformGateway(
            training_settings,
            experiment_root=experiment_root,
            storage_root=settings.data_dir,
        )
        self.training_runs = TrainingRunService(
            training_settings,
            self.provider,
            self.splits,
            experiment_root=experiment_root,
            storage_root=settings.data_dir,
        )
        self.validated_experiments = ValidatedExperimentService(
            self.database.unit_of_work, settings.validation_secret, self.splits
        )
        self.scheduler_state = SchedulerStateService(self.database.unit_of_work)

        self.artifacts = ArtifactService(
            self.database.unit_of_work,
            self.provider,
            ManagedArtifacts(settings.data_dir),
            settings.checkpoint_limit,
        )
        self.results = ResultService(
            self.database.unit_of_work, self.documents, LocalResultFiles(settings.data_dir)
        )
        self.analysis = AnalysisService(
            self.database.unit_of_work,
            self.results,
            self.splits,
            BasicDifferenceAnalyzer(),
            BasicChartBuilder(),
        )

    def close(self) -> None:
        self.database.engine.dispose()
        self.lease.close()
