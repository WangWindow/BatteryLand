import sys
import time
from pathlib import Path

import pytest

from batteryland.common.errors import DomainError
from batteryland.scheduler.processes import ProcessSupervisor


def test_signals_require_identity_and_stop_the_whole_process_group(tmp_path: Path):
    runner = ProcessSupervisor()
    child = "import signal,time; signal.signal(signal.SIGINT,signal.SIG_IGN); signal.signal(signal.SIGTERM,signal.SIG_IGN); print('child-ready',flush=True); time.sleep(30)"
    parent = "import signal,time,subprocess,sys; signal.signal(signal.SIGINT,signal.SIG_IGN); signal.signal(signal.SIGTERM,signal.SIG_IGN); subprocess.Popen([sys.executable,'-c',sys.argv[1]]); print('parent-ready',flush=True); time.sleep(30)"
    receipt = runner.start([sys.executable, "-c", parent, child], tmp_path, "owned-group")
    try:
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if "child-ready" in (tmp_path / "console.log").read_text():
                break
            time.sleep(0.01)
        else:
            raise AssertionError("Process group did not become ready")
        mismatched = receipt | {"start_ticks": receipt["start_ticks"] + 1}
        with pytest.raises(DomainError, match="ownership"):
            runner.signal(mismatched, "kill")
        assert runner.observe(receipt)["alive"]
        runner.signal(receipt, "interrupt")
        runner.signal(receipt, "terminate")
        assert runner.observe(receipt)["alive"]
        runner.signal(receipt, "kill")
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if not runner.observe(receipt)["alive"]:
                break
            time.sleep(0.01)
        assert not runner.observe(receipt)["alive"]
    finally:
        runner.signal(receipt, "kill")
