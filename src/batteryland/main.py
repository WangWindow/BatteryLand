"""Local application and maintenance entry point."""

import json
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID

import typer

from batteryland.common.errors import DomainError
from batteryland.config import Settings
from batteryland.container import Container
from batteryland.datasets.bundled import BundledImportService
from batteryland.datasets.bundled_loader import load_bundled
from batteryland.training.gateway import DeeplatformGateway

app = typer.Typer(
    name="batteryland",
    help="Manage the BatteryLand backend and local data.",
    no_args_is_help=True,
)


def _execute(
    command: Literal["init", "serve", "import-bundled", "reconcile"],
    data_dir: Path | None,
    *,
    host: str = "127.0.0.1",
    port: int = 8000,
    source_id: UUID | None = None,
    experiment_id: UUID | None = None,
) -> None:
    try:
        settings = Settings.from_env(data_dir)
        if command == "serve":
            import uvicorn

            from batteryland.api.app import create_app

            uvicorn.run(create_app(settings, start_monitor=True), host=host, port=port, workers=1)
            return
        container = Container(settings)
        try:
            if command == "init":
                result = {"initialized": True, "data_dir": str(settings.data_dir)}
            elif command == "import-bundled":
                if source_id is None:
                    raise ValueError("source_id is required")
                DeeplatformGateway(settings).identity()
                with container.database.unit_of_work() as unit:
                    source = unit.resources.get_source(str(source_id))
                root = settings.source_roots.get(source["root_alias"])
                if root is None:
                    raise DomainError("invalid_input", "Source alias is not configured")
                result = BundledImportService(
                    container.resources, container.splits, container.configurations
                ).import_catalog(source["id"], load_bundled(settings.provider_root, root))
            else:
                if experiment_id is None:
                    raise ValueError("experiment_id is required")
                result = container.execution.reconcile(str(experiment_id))
            typer.echo(json.dumps(result, ensure_ascii=False))
        finally:
            container.close()
    except (DomainError, ValueError, OSError) as exc:
        typer.echo(
            json.dumps(
                {
                    "error": exc.symbol if isinstance(exc, DomainError) else "invalid_input",
                    "message": str(exc),
                }
            ),
            err=True,
        )
        raise typer.Exit(code=1) from exc


@app.command()
def init(
    data_dir: Annotated[Path | None, typer.Option(help="Backend data directory.")] = None,
) -> None:
    """Initialize the local database and data directory."""
    _execute("init", data_dir)


@app.command()
def serve(
    data_dir: Annotated[Path | None, typer.Option(help="Backend data directory.")] = None,
    host: Annotated[str, typer.Option(help="Address to bind the backend to.")] = "127.0.0.1",
    port: Annotated[
        int, typer.Option(min=1, max=65535, help="Port to bind the backend to.")
    ] = 8000,
) -> None:
    """Run the FastAPI backend."""
    _execute("serve", data_dir, host=host, port=port)


@app.command("import-bundled")
def import_bundled(
    source_id: Annotated[UUID, typer.Option(help="Registered data source ID.")],
    data_dir: Annotated[Path | None, typer.Option(help="Backend data directory.")] = None,
) -> None:
    """Import the pinned provider's bundled data catalog."""
    _execute("import-bundled", data_dir, source_id=source_id)


@app.command()
def reconcile(
    experiment_id: Annotated[UUID, typer.Option(help="Experiment ID to reconcile.")],
    data_dir: Annotated[Path | None, typer.Option(help="Backend data directory.")] = None,
) -> None:
    """Reconcile an experiment's local process state."""
    _execute("reconcile", data_dir, experiment_id=experiment_id)


def main() -> None:
    app()


if __name__ == "__main__":
    main()
