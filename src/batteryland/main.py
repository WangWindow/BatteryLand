"""Local application and maintenance entry point."""

import json
from pathlib import Path
from typing import Annotated, Literal

import typer

from batteryland.common.errors import DomainError
from batteryland.config import Settings
from batteryland.container import Container

app = typer.Typer(
    name="batteryland",
    help="Manage the BatteryLand backend and local data.",
    no_args_is_help=True,
)


def _execute(
    command: Literal["init", "serve"],
    data_dir: Path | None,
    *,
    host: str = "127.0.0.1",
    port: int = 8000,
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
            result = {"initialized": True, "data_dir": str(settings.data_dir)}
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


def main() -> None:
    app()


if __name__ == "__main__":
    main()
