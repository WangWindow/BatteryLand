"""Local application and maintenance entry point."""

import argparse
import json
import sys
from pathlib import Path
from uuid import UUID

from batteryland.common.errors import DomainError
from batteryland.config import Settings
from batteryland.container import Container
from batteryland.datasets.bundled import BundledImportService
from batteryland.datasets.bundled_loader import load_bundled
from batteryland.training.gateway import DeeplatformGateway


def main() -> None:
    parser = argparse.ArgumentParser(prog="batteryland")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("init", "serve", "import-bundled", "reconcile"):
        command = commands.add_parser(name)
        command.add_argument("--data-dir", type=Path)
        if name == "serve":
            command.add_argument("--host", default="127.0.0.1")
            command.add_argument("--port", type=int, default=8000)
        elif name == "import-bundled":
            command.add_argument("--source-id", type=UUID, required=True)
        elif name == "reconcile":
            command.add_argument("--experiment-id", type=UUID, required=True)
    args = parser.parse_args()
    try:
        settings = Settings.from_env(args.data_dir)
        if args.command == "serve":
            import uvicorn

            from batteryland.api.app import create_app

            uvicorn.run(
                create_app(settings, start_monitor=True), host=args.host, port=args.port, workers=1
            )
            return
        container = Container(settings)
        try:
            if args.command == "init":
                result = {"initialized": True, "data_dir": str(settings.data_dir)}
            elif args.command == "import-bundled":
                DeeplatformGateway(settings).identity()
                with container.database.unit_of_work() as unit:
                    source = unit.resources.get_source(str(args.source_id))
                root = settings.source_roots.get(source["root_alias"])
                if root is None:
                    raise DomainError("invalid_input", "Source alias is not configured")
                result = BundledImportService(
                    container.resources, container.splits, container.configurations
                ).import_catalog(source["id"], load_bundled(settings.provider_root, root))
            else:
                result = container.execution.reconcile(str(args.experiment_id))
            print(json.dumps(result, ensure_ascii=False))
        finally:
            container.close()
    except (DomainError, ValueError, OSError) as exc:
        print(
            json.dumps(
                {
                    "error": exc.symbol if isinstance(exc, DomainError) else "invalid_input",
                    "message": str(exc),
                }
            ),
            file=sys.stderr,
        )
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
