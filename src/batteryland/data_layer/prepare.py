"""Prepare the original Web catalog and audits in BatteryLand's var directory."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

from batteryland.config import Settings


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare BatteryLife data layer catalog and audits")
    parser.add_argument("--data", type=Path, help="trusted read-only BatteryLife data root")
    parser.add_argument("--output", type=Path, help="cache directory (default: BatteryLand var/data-layer)")
    args = parser.parse_args()
    settings = Settings.from_env()
    root = args.data or settings.source_roots.get("battery_life")
    if root is None or not (root / "Life labels").is_dir():
        parser.error("battery_life source root must contain Life labels")
    output = (args.output or settings.data_dir / "data-layer").resolve()
    if output == root.resolve() or root.resolve() in output.parents:
        parser.error("cache output must be outside the read-only source root")
    output.mkdir(parents=True, exist_ok=True)
    environment = dict(os.environ, BATTERYLAND_DATA_LAYER_CACHE_DIR=str(output))
    steps = [
        (
            "build_catalog",
            ["--data", str(root), "--db", str(output / "catalog.sqlite3"),
             "--report", str(output / "FULL_DATA_AUDIT.md")],
        ),
        ("audit_data_quality", []),
        ("audit_early_cycles", []),
        ("build_delivery_manifest", []),
    ]
    for module, arguments in steps:
        print(f"Preparing {module} in {output}", flush=True)
        subprocess.run(
            [sys.executable, "-m", f"batteryland.data_layer.legacy.scripts.{module}", *arguments],
            env=environment,
            check=True,
        )


if __name__ == "__main__":
    main()
