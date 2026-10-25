from sqlalchemy.orm import Session

from batteryland.infrastructure.persistence.artifacts import SqlArtifactRepository
from batteryland.infrastructure.persistence.configurations import SqlTemplateRepository
from batteryland.infrastructure.persistence.documents import SqlDocumentRepository
from batteryland.infrastructure.persistence.experiments import SqlExperimentRepository
from batteryland.infrastructure.persistence.named_groups import SqlNamedGroupRepository
from batteryland.infrastructure.persistence.resources import SqlResourceRepository
from batteryland.infrastructure.persistence.results import SqlResultRepository
from batteryland.infrastructure.persistence.splits import SqlSplitRepository
from batteryland.infrastructure.persistence.validated_inputs import SqlValidatedInputRepository
from batteryland.infrastructure.persistence.workers import SqlWorkerRepository


class SqlUnitOfWork:
    def __init__(self, session: Session) -> None:
        self.resources = SqlResourceRepository(session)
        self.named_groups = SqlNamedGroupRepository(session)
        self.validated_inputs = SqlValidatedInputRepository(session)
        self.workers = SqlWorkerRepository(session)
        self.documents = SqlDocumentRepository(session)
        self.splits = SqlSplitRepository(session)
        self.templates = SqlTemplateRepository(session)
        self.experiments = SqlExperimentRepository(session)
        self.artifacts = SqlArtifactRepository(session)
        self.results = SqlResultRepository(session)
