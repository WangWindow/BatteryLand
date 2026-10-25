from batteryland.common.errors import DomainError

ACTIVE_STATES = {"starting", "running", "stopping", "needs_reconciliation"}
TERMINAL_STATES = {"succeeded", "failed", "cancelled", "stopped"}
TRANSITIONS = {
    "draft": {"queued"},
    "queued": {"starting", "cancelled"},
    "starting": {"running", "failed", "stopping", "needs_reconciliation"},
    "running": {"succeeded", "failed", "stopping", "needs_reconciliation"},
    "stopping": {"stopped", "succeeded", "needs_reconciliation"},
    "needs_reconciliation": {"running", "stopping", "succeeded", "failed", "stopped"},
}


def ensure_transition(current: str, target: str) -> None:
    if target not in TRANSITIONS.get(current, set()):
        raise DomainError("conflict", f"Experiment cannot transition from {current} to {target}")
