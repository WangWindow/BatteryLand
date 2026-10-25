"""Compose concrete infrastructure at the outside edge of the application."""

from dataclasses import replace

from batteryland.analytics.basic import BasicChartBuilder, BasicDifferenceAnalyzer
from batteryland.analytics.service import AnalysisService
from batteryland.common.storage import LocalSourceFiles, ManagedArtifacts
from batteryland.components.service import ArtifactService
from batteryland.config import Settings
from batteryland.datasets.catalog import FixedCatalogIndexer, NamedGroupService
from batteryland.datasets.service import ResourceService
from batteryland.datasets.splits import SplitService
from batteryland.db.database import Database
from batteryland.documents.store import SQLiteDocumentStore
from batteryland.experiments.legacy_execution import ExecutionService
from batteryland.experiments.service import ExperimentService
from batteryland.experiments.templates import ConfigurationService
from batteryland.experiments.validated import ValidatedExperimentService
from batteryland.results.service import ResultService
from batteryland.results.storage import LocalResultFiles
from batteryland.scheduler.operations import WorkerProtocolService
from batteryland.scheduler.policy import FifoPolicy
from batteryland.scheduler.processes import RuntimeLease
from batteryland.training.contracts import TrainingGateway
from batteryland.training.disabled import DisabledTrainingGateway
from batteryland.training.gateway import DeeplatformGateway
from batteryland.training.materializer import ExecutionMaterializer
from batteryland.training.runs import TrainingRunService


class Container:
    def __init__(
        self,
        settings: Settings,
        training: TrainingGateway | None = None,
        *,
        legacy_provider: bool = True,
    ) -> None:
        self.settings = settings
        self.lease = RuntimeLease(settings.data_dir)
        try:
            self.database = Database(settings.data_dir / "platform.sqlite")
            self.database.initialize()
            self._compose(settings, training, legacy_provider)
        except BaseException:
            if hasattr(self, "database"):
                self.database.engine.dispose()
            self.lease.close()
            raise

    def _compose(
        self, settings: Settings, training: TrainingGateway | None, legacy_provider: bool
    ) -> None:
        self.documents = SQLiteDocumentStore(
            self.database.unit_of_work, settings.data_dir / "documents"
        )
        self.documents.migrate_legacy()
        self.resources = ResourceService(
            self.database.unit_of_work, LocalSourceFiles(settings.source_roots)
        )
        self.splits = SplitService(self.database.unit_of_work, self.documents)
        self.named_groups = NamedGroupService(self.database.unit_of_work)
        training_settings = replace(settings, data_dir=settings.data_dir / "training")
        self.provider = DeeplatformGateway(settings if legacy_provider else training_settings)
        self.training_runs = (
            None if legacy_provider else TrainingRunService(training_settings, self.provider)
        )
        self.training = (
            training
            if training is not None
            else DeeplatformGateway(settings)
            if legacy_provider
            else DisabledTrainingGateway()
        )
        self.configurations = ConfigurationService(self.database.unit_of_work, self.documents)
        self.experiments = ExperimentService(
            self.database.unit_of_work, self.documents, self.training
        )
        self.validated_experiments = ValidatedExperimentService(
            self.database.unit_of_work, settings.validation_secret
        )
        self.workers = WorkerProtocolService(self.database.unit_of_work)

        self.execution = ExecutionService(
            self.database.unit_of_work,
            self.documents,
            self.experiments,
            self.training,
            ExecutionMaterializer(settings.data_dir),
            FifoPolicy(),
            settings.interrupt_timeout,
            settings.terminate_timeout,
        )

        self.artifacts = ArtifactService(
            self.database.unit_of_work,
            self.provider,
            ManagedArtifacts(settings.data_dir),
            settings.checkpoint_limit,
            external_execution=not legacy_provider,
        )
        self.results = ResultService(
            self.database.unit_of_work, self.documents, LocalResultFiles(settings.data_dir)
        )
        self.execution.collect = self.results.collect
        self.execution.collect_pending = self.results.collect_pending
        self.analysis = AnalysisService(
            self.database.unit_of_work,
            self.results,
            self.splits,
            BasicDifferenceAnalyzer(),
            BasicChartBuilder(),
        )
        if settings.auto_index_catalog:
            FixedCatalogIndexer(settings, self.resources, self.database.unit_of_work).index()

    def close(self) -> None:
        self.database.engine.dispose()
        self.lease.close()
