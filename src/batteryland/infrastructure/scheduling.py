"""Local serial dispatch and ownership-checked Linux process groups."""

import fcntl
import json
import os
import signal
import subprocess
from datetime import UTC, datetime
from pathlib import Path

from batteryland.application.ports.persistence import Record
from batteryland.domain.errors import DomainError


class RuntimeLease:
    def __init__(self, root: Path) -> None:
        root.mkdir(parents=True, exist_ok=True)
        self.descriptor = os.open(
            root / ".backend.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600
        )
        try:
            fcntl.flock(self.descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            os.close(self.descriptor)
            raise DomainError("conflict", "Another backend owns this runtime directory") from exc

    def close(self) -> None:
        if self.descriptor >= 0:
            os.close(self.descriptor)
            self.descriptor = -1


def process_identity(pid: int) -> Record | None:
    try:
        root = Path(f"/proc/{pid}")
        values = (root / "stat").read_text().rsplit(")", 1)[1].split()
        return {
            "pid": pid,
            "pgid": int(values[2]),
            "start_ticks": int(values[19]),
            "state": values[0],
            "uid": root.stat().st_uid,
        }
    except OSError, ValueError, IndexError:
        return None


class ProcessSupervisor:
    def __init__(self) -> None:
        self.boot_id = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        self.processes: dict[int, subprocess.Popen[bytes]] = {}
        self.receipts: dict[str, Record] = {}

    def start(
        self,
        command: list[str],
        directory: Path,
        experiment_id: str,
        *,
        cwd: Path | None = None,
        environment: dict[str, str] | None = None,
    ) -> Record:
        directory.mkdir(parents=True, exist_ok=True)
        env = os.environ | (environment or {}) | {"BATTERYLAND_EXECUTION_ID": experiment_id}
        with (directory / "console.log").open("ab") as output:
            process = subprocess.Popen(
                command,
                cwd=cwd or directory,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        self.processes[process.pid] = process
        identity = process_identity(process.pid)
        if identity is None:
            raise DomainError(
                "needs_reconciliation", "Started process identity cannot be confirmed"
            )
        receipt = identity | {
            "boot_id": self.boot_id,
            "experiment_id": experiment_id,
            "directory": str(directory),
            "started_at": datetime.now(UTC).isoformat(),
        }
        self.receipts[experiment_id] = receipt
        return receipt

    def _members(self, pgid: int) -> list[Record]:
        members = []
        for path in Path("/proc").iterdir():
            if not path.name.isdecimal():
                continue
            identity = process_identity(int(path.name))
            if identity and identity["pgid"] == pgid and identity["state"] != "Z":
                members.append(identity)
        return members

    def observe(self, receipt: Record) -> Record:
        if receipt.get("boot_id") != self.boot_id or receipt.get("uid") != os.getuid():
            return {
                "alive": False,
                "identity_matches": False,
                "exit_code": None,
                "provider_status": None,
                "observed_at": datetime.now(UTC).isoformat(),
            }
        pid = receipt["pid"]
        process = self.processes.get(pid)
        exit_code = process.poll() if process is not None else None
        current = process_identity(pid)
        matches = current is None or (
            current["start_ticks"] == receipt["start_ticks"]
            and current["pgid"] == receipt["pgid"]
            and current["uid"] == receipt["uid"]
        )
        members = self._members(receipt["pgid"])
        if current is None and members:
            marker = f"BATTERYLAND_EXECUTION_ID={receipt['experiment_id']}".encode()
            for member in members:
                try:
                    environment = Path(f"/proc/{member['pid']}/environ").read_bytes().split(b"\0")
                except OSError:
                    matches = False
                    break
                if (
                    marker not in environment
                    or member["uid"] != receipt["uid"]
                    or member["start_ticks"] < receipt["start_ticks"]
                ):
                    matches = False
                    break
        status = None
        try:
            status = json.loads((Path(receipt["directory"]) / "status.json").read_text()).get(
                "status"
            )
        except OSError, ValueError, AttributeError:
            pass
        # The leader may exit between the first poll and the /proc scan.
        # Reap again before interpreting an empty group as an uncertain exit.
        if process is not None:
            exit_code = process.poll()
        alive = bool(members) or process is not None and exit_code is None
        return {
            "alive": alive,
            "identity_matches": matches,
            "exit_code": exit_code,
            "provider_status": status,
            "effective_device": receipt.get("effective_device"),
            "observed_at": datetime.now(UTC).isoformat(),
        }

    def signal(self, receipt: Record, stage: str) -> Record:
        observed = self.observe(receipt)
        if not observed["identity_matches"]:
            raise DomainError("needs_reconciliation", "Process ownership cannot be verified")
        if observed["alive"]:
            sig = {"interrupt": signal.SIGINT, "terminate": signal.SIGTERM, "kill": signal.SIGKILL}[
                stage
            ]
            try:
                os.killpg(receipt["pgid"], sig)
            except ProcessLookupError:
                pass
        return self.observe(receipt)
