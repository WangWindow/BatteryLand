"""Sample host resources and map CUDA logical indices to NVML devices."""

import os
from typing import Any

import psutil
import pynvml


def choose_device(requested: str, snapshot: dict[str, Any]) -> str | None:
    available = {
        f"cuda:{gpu['cuda_index']}": gpu
        for gpu in snapshot.get("gpus", [])
        if isinstance(gpu.get("free_bytes"), int) and gpu["free_bytes"] > 0
    }
    if requested == "auto":
        if not available:
            return None
        return max(available, key=lambda key: available[key]["free_bytes"])
    return requested if requested in available else None


class ResourceSampler:
    def sample(self) -> dict[str, Any]:
        memory = psutil.virtual_memory()
        snapshot: dict[str, Any] = {
            "cpu_percent": psutil.cpu_percent(interval=None),
            "memory_total": memory.total,
            "memory_available": memory.available,
            "gpus": [],
            "reason": None,
        }
        try:
            pynvml.nvmlInit()
            count = pynvml.nvmlDeviceGetCount()
            devices = []
            for physical_index in range(count):
                handle = pynvml.nvmlDeviceGetHandleByIndex(physical_index)
                uuid = pynvml.nvmlDeviceGetUUID(handle)
                uuid = uuid.decode() if isinstance(uuid, bytes) else uuid
                devices.append((physical_index, uuid, handle))
            visible = os.environ.get("CUDA_VISIBLE_DEVICES")
            if visible is None:
                mapped = devices
            else:
                mapped = []
                for token in visible.split(","):
                    token = token.strip()
                    if token.isdecimal():
                        match = next((value for value in devices if value[0] == int(token)), None)
                    else:
                        match = next((value for value in devices if value[1] == token), None)
                    if match is None:
                        raise ValueError("CUDA_VISIBLE_DEVICES has an unknown or unsupported GPU")
                    mapped.append(match)
                if len({item[1] for item in mapped}) != len(mapped):
                    raise ValueError("CUDA_VISIBLE_DEVICES contains duplicate GPUs")
            for logical_index, (_, uuid, handle) in enumerate(mapped):
                mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
                utilization = pynvml.nvmlDeviceGetUtilizationRates(handle)
                try:
                    process_pids = [
                        int(process.pid)
                        for process in pynvml.nvmlDeviceGetComputeRunningProcesses(handle)
                    ]
                except pynvml.NVMLError:
                    process_pids = None
                snapshot["gpus"].append(
                    {
                        "cuda_index": logical_index,
                        "uuid": uuid,
                        "total_bytes": mem.total,
                        "free_bytes": mem.free,
                        "memory_used_bytes": mem.used,
                        "utilization_percent": float(utilization.gpu),
                        "process_pids": process_pids,
                        "reason": None,
                    }
                )
        except (pynvml.NVMLError, ValueError) as exc:
            snapshot["gpus"] = []
            snapshot["reason"] = str(exc)
        finally:
            try:
                pynvml.nvmlShutdown()
            except pynvml.NVMLError:
                pass
        return snapshot
