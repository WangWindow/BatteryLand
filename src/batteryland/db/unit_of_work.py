from sqlalchemy.orm import Session

from batteryland.components.repository import SqlArtifactRepository
from batteryland.datasets.catalog_repository import (
    SqlCatalogRepository,
    SqlLogicalDatasetRepository,
)
from batteryland.datasets.repository import SqlResourceRepository
from batteryland.datasets.split_repository import SqlSplitRepository
from batteryland.documents.repository import SqlDocumentRepository
from batteryland.experiments.input_repository import SqlValidatedInputRepository
from batteryland.experiments.repository import SqlExperimentRepository
from batteryland.results.repository import SqlResultRepository
from batteryland.scheduler.repository import SqlWorkerRepository


class SqlUnitOfWork:
    def __init__(self, session: Session) -> None:
        self.resources = SqlResourceRepository(session)
        self.catalog = SqlCatalogRepository(session)
        self.logical_datasets = SqlLogicalDatasetRepository(session)
        self.validated_inputs = SqlValidatedInputRepository(session)
        self.workers = SqlWorkerRepository(session)
        self.documents = SqlDocumentRepository(session)
        self.splits = SqlSplitRepository(session)
        self.experiments = SqlExperimentRepository(session)
        self.artifacts = SqlArtifactRepository(session)
        self.results = SqlResultRepository(session)
