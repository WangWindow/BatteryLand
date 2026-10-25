"""Compose concrete infrastructure at the outside edge of the application."""

from batteryland.application.analysis import AnalysisService
from batteryland.application.artifacts import ArtifactService
from batteryland.application.configurations import ConfigurationService
from batteryland.application.execution import ExecutionService
from batteryland.application.experiments import ExperimentService
from batteryland.application.fixed_catalog import FixedCatalogIndexer, NamedGroupService
from batteryland.application.ports.training import TrainingGateway
from batteryland.application.resources import ResourceService
from batteryland.application.results import ResultService
from batteryland.application.splits import SplitService
from batteryland.config import Settings
from batteryland.domain.scheduling import FifoPolicy
from batteryland.infrastructure.analysis import BasicChartBuilder, BasicDifferenceAnalyzer
from batteryland.infrastructure.documents import SQLiteDocumentStore
from batteryland.infrastructure.files import LocalSourceFiles, ManagedArtifacts
from batteryland.infrastructure.persistence.database import Database
from batteryland.infrastructure.results import LocalResultFiles
from batteryland.infrastructure.scheduling import RuntimeLease
from batteryland.infrastructure.training.gateway import DeeplatformGateway
from batteryland.infrastructure.training.materializer import ExecutionMaterializer


class Container:
    def __init__(self, settings: Settings, training: TrainingGateway | None = None) -> None:
        self.settings = settings
        self.lease = RuntimeLease(settings.data_dir)
        try:
            self.database = Database(settings.data_dir / "platform.sqlite")
            self.database.initialize()
            self._compose(settings, training)
        except BaseException:
            if hasattr(self, "database"):
                self.database.engine.dispose()
            self.lease.close()
            raise

    def _compose(self, settings: Settings, training: TrainingGateway | None) -> None:
        self.documents = SQLiteDocumentStore(
            self.database.unit_of_work, settings.data_dir / "documents"
        )
        self.documents.migrate_legacy()
        self.resources = ResourceService(
            self.database.unit_of_work, LocalSourceFiles(settings.source_roots)
        )
        self.splits = SplitService(self.database.unit_of_work, self.documents)
        self.named_groups = NamedGroupService(self.database.unit_of_work)
        self.provider = DeeplatformGateway(settings)
        self.training = training if training is not None else self.provider
        self.configurations = ConfigurationService(self.database.unit_of_work, self.documents)
        self.experiments = ExperimentService(
            self.database.unit_of_work, self.documents, self.training
        )

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
