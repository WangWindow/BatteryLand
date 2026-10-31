"""Cycle-level features used by the domain shift analysis."""

import re

import numpy as np

FEATURE_VERSION = 3

SIGNAL_KEYS = {
    "current": "current_in_A",
    "voltage": "voltage_in_V",
    "charge_capacity": "charge_capacity_in_Ah",
    "discharge_capacity": "discharge_capacity_in_Ah",
    "time": "time_in_s",
    "temperature": "temperature_in_C",
}
PHASES = ("charge", "discharge")
_STAT_FUNCS = {"mean": np.mean, "std": np.std, "min": np.min, "max": np.max}
STATS = tuple(_STAT_FUNCS)
TIME_STATS = tuple(name for name in STATS if name != "min")
CURVE_Q = (0.3, 0.7)
CURRENT_THRESHOLD_RATIO = 0.05


def _finite(value: object) -> np.ndarray:
    if value is None:
        return np.array([], dtype=float)
    try:
        array = np.asarray(value, dtype=float).reshape(-1)
    except (TypeError, ValueError):
        return np.array([], dtype=float)
    return array[np.isfinite(array)]


def _select(raw: object, mask: np.ndarray) -> np.ndarray:
    if raw is None:
        return np.array([], dtype=float)
    try:
        array = np.asarray(raw, dtype=float).reshape(-1)
    except (TypeError, ValueError):
        return np.array([], dtype=float)
    length = min(array.size, mask.size)
    return array[:length][mask[:length]]


def _stats(prefix: str, values: np.ndarray, output: dict[str, float], stats=STATS) -> None:
    values = values[np.isfinite(values)]
    for name in stats:
        output[f"{prefix}_{name}"] = (
            float(_STAT_FUNCS[name](values)) if values.size else np.nan
        )


def _phase_features(
    cycle: dict[str, object], phase: str, mask: np.ndarray, output: dict[str, float]
) -> None:
    voltage = np.array([], dtype=float)
    for short, key in SIGNAL_KEYS.items():
        selected = _select(cycle.get(key), mask)
        selected = selected[np.isfinite(selected)]
        if short == "time" and selected.size:
            selected = selected - selected[0]
        if short == "voltage":
            voltage = selected
        _stats(
            f"{phase}_{short}",
            selected,
            output,
            TIME_STATS if short == "time" else STATS,
        )
    for quantile in CURVE_Q:
        output[f"{phase}_voltage_curve_p{int(round(quantile * 100)):02d}"] = (
            float(np.quantile(voltage, quantile)) if voltage.size else np.nan
        )


def extract_cycle_features(
    cycle: dict[str, object], nominal_capacity_ah: float = np.nan
) -> dict[str, float]:
    try:
        capacity = float(nominal_capacity_ah)
    except (TypeError, ValueError):
        capacity = np.nan
    capacity = capacity if np.isfinite(capacity) and capacity > 0 else np.nan

    output: dict[str, float] = {}
    try:
        raw_current = cycle.get("current_in_A")
        current = (
            np.asarray(raw_current, dtype=float).reshape(-1)
            if raw_current is not None
            else np.array([], dtype=float)
        )
    except (TypeError, ValueError):
        current = np.array([], dtype=float)

    finite_abs = np.abs(current[np.isfinite(current)])
    threshold = (
        max(float(finite_abs.max()) * CURRENT_THRESHOLD_RATIO, 1e-8)
        if finite_abs.size
        else 1e-8
    )
    finite = np.isfinite(current)
    masks = {
        "charge": finite & (current > threshold),
        "discharge": finite & (current < -threshold),
    }
    for phase in PHASES:
        _phase_features(cycle, phase, masks[phase], output)

    for key, prefix in (
        ("charge_capacity_in_Ah", "charge_capacity"),
        ("discharge_capacity_in_Ah", "discharge_capacity"),
    ):
        values = _finite(cycle.get(key))
        output[f"{prefix}_max_Ah"] = float(values.max()) if values.size else np.nan

    times = _finite(cycle.get("time_in_s"))
    output["cycle_duration_s"] = float(times.max() - times.min()) if times.size else np.nan

    temperature = _finite(cycle.get("temperature_in_C"))
    output["temperature_available"] = int(temperature.size > 0)
    output["temperature_mean_C"] = float(temperature.mean()) if temperature.size else np.nan
    output["temperature_std_C"] = float(temperature.std()) if temperature.size else np.nan
    output["temperature_max_C"] = float(temperature.max()) if temperature.size else np.nan

    resistance = _finite(cycle.get("internal_resistance_in_ohm"))
    output["internal_resistance_mean_ohm"] = (
        float(resistance.mean()) if resistance.size else np.nan
    )

    charge = output["charge_capacity_max_Ah"]
    discharge = output["discharge_capacity_max_Ah"]
    valid_ratio = np.isfinite(charge) and np.isfinite(discharge) and charge > 1e-6
    output["discharge_charge_capacity_ratio"] = (
        float(discharge / charge) if valid_ratio and discharge >= 0 else np.nan
    )
    output["capacity_ratio_flag"] = int(
        valid_ratio and (discharge / charge > 2.0 or discharge / charge < 0.5)
    )

    for phase in PHASES:
        for statistic in STATS:
            value = output.get(f"{phase}_current_{statistic}", np.nan)
            output[f"{phase}_current_Crate_{statistic}"] = (
                value / capacity if np.isfinite(capacity) and np.isfinite(value) else np.nan
            )
            for capacity_type in ("charge", "discharge"):
                value = output.get(
                    f"{phase}_{capacity_type}_capacity_{statistic}", np.nan
                )
                output[f"{phase}_{capacity_type}_capacity_frac_{statistic}"] = (
                    value / capacity
                    if np.isfinite(capacity) and np.isfinite(value)
                    else np.nan
                )
    for prefix in ("charge_capacity", "discharge_capacity"):
        value = output[f"{prefix}_max_Ah"]
        output[f"{prefix}_max_fraction_nominal"] = (
            value / capacity if np.isfinite(capacity) and np.isfinite(value) else np.nan
        )
    return output


_STAT_RE = "(?:" + "|".join(STATS) + ")"
_RAW_CURRENT = re.compile(rf"^(?:charge|discharge)_current_{_STAT_RE}$")
_RAW_PHASE_CAP = re.compile(
    rf"^(?:charge|discharge)_(?:charge|discharge)_capacity_{_STAT_RE}$"
)
_NOT_FEATURES = {"nominal_capacity_Ah", "temperature_available", "capacity_ratio_flag"}


def is_comparable(name: str) -> bool:
    if name in _NOT_FEATURES:
        return False
    if _RAW_CURRENT.match(name) or _RAW_PHASE_CAP.match(name):
        return False
    return not name.endswith("_Ah")


def feature_group(name: str) -> str:
    if "voltage_curve" in name:
        return "电压曲线形状"
    if "_voltage_" in name:
        return "电压统计"
    if "temperature" in name:
        return "温度"
    if "Crate" in name:
        return "倍率(C-rate)"
    if "capacity" in name:
        return "容量(归一化)"
    if "_time_" in name or name == "cycle_duration_s":
        return "时间/时长"
    if "resistance" in name:
        return "内阻"
    return "其他"
