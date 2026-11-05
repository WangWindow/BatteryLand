"""Conservative, reproducible incremental-capacity curves from full cycle samples."""

from __future__ import annotations

import math
from statistics import median


BIN_V = 0.005
SMOOTH_BINS = 5
MIN_SAMPLES = 30
MIN_DERIVATIVE_BINS = 20
MIN_VOLTAGE_SPAN = 0.10
CURRENT_TOLERANCE = 0.10


def finite(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def vector_length(array):
    if array is None or isinstance(array, (str, bytes, dict)):
        return None
    try:
        return len(array)
    except (TypeError, ValueError):
        return None


def unavailable(reason, samples=0, voltage_span=0, bins=0):
    return {"status": "unavailable", "reason": reason, "sample_count": samples,
            "voltage_span_V": round(voltage_span, 4), "voltage_range_V": None,
            "derivative_bins": bins, "points": []}


def phase_curve(cycle, phase):
    """Use one continuous, near-constant-current phase; never join disjoint runs."""
    keys = ("time_in_s", "voltage_in_V", "current_in_A",
            "charge_capacity_in_Ah" if phase == "charge" else "discharge_capacity_in_Ah")
    arrays = [cycle.get(key) for key in keys]
    lengths = [vector_length(array) for array in arrays]
    if any(length is None for length in lengths):
        return unavailable("缺少时间、电压、电流或该阶段容量采样")
    count = lengths[0]
    if count < MIN_SAMPLES or any(length != count for length in lengths):
        return unavailable("采样数组长度不一致，或总采样少于 30 点")

    rows = [tuple(finite(array[i]) for array in arrays) for i in range(count)]
    peak_current = max((abs(row[2]) for row in rows if row[2] is not None), default=0)
    minimum_current = max(1e-9, peak_current * 0.02)
    runs = []
    run = []
    invalid_time = False

    def close_run():
        nonlocal run
        if run:
            runs.append(run)
        run = []

    for left, right in zip(rows, rows[1:]):
        if any(value is None for value in left + right):
            close_run()
            continue
        t0, v0, i0, q0 = left
        t1, v1, i1, q1 = right
        if t1 <= t0:
            invalid_time = True
            close_run()
            continue
        same_current = (abs(i0) >= minimum_current and abs(i1) >= minimum_current
                        and i0 * i1 > 0)
        voltage_step = v1 - v0 if phase == "charge" else v0 - v1
        capacity_step = q1 - q0
        if not same_current or voltage_step < -BIN_V or capacity_step < -1e-9:
            close_run()
            continue
        if run and (run[-1] != left or
                    abs(abs(i1) - abs(run[0][2])) >
                    CURRENT_TOLERANCE * abs(run[0][2])):
            close_run()
        if not run:
            run = [left]
        run.append(right)
    close_run()

    best = None
    max_samples = max((len(run) for run in runs), default=0)
    max_span = max((max(row[1] for row in run) - min(row[1] for row in run)
                    for run in runs if len(run) >= MIN_SAMPLES), default=0)
    max_bins = 0
    for run in runs:
        if len(run) < MIN_SAMPLES:
            continue
        magnitudes = [abs(row[2]) for row in run]
        typical = median(magnitudes)
        if any(abs(current - typical) > CURRENT_TOLERANCE * typical for current in magnitudes):
            continue
        span = max(row[1] for row in run) - min(row[1] for row in run)
        if span < MIN_VOLTAGE_SPAN or max(row[3] for row in run) <= min(row[3] for row in run):
            continue
        buckets = {}
        for _, voltage, _, capacity in run:
            index = math.floor(voltage / BIN_V + 0.5)
            buckets.setdefault(index, []).append(capacity)
        capacity_by_bin = {index: median(values) for index, values in buckets.items()}
        indices = sorted(capacity_by_bin)
        derivative_runs = []
        derivative_run = []
        for low, high in zip(indices, indices[1:]):
            difference = ((capacity_by_bin[high] - capacity_by_bin[low]) if phase == "charge"
                          else (capacity_by_bin[low] - capacity_by_bin[high]))
            if high != low + 1 or difference < -1e-9:
                if derivative_run:
                    derivative_runs.append(derivative_run)
                derivative_run = []
                continue
            derivative_run.append([(low + 0.5) * BIN_V, difference / BIN_V])
        if derivative_run:
            derivative_runs.append(derivative_run)
        longest = max(derivative_runs, key=len, default=[])
        max_bins = max(max_bins, len(longest))
        if len(longest) < MIN_DERIVATIVE_BINS:
            continue
        score = (len(longest), span, len(run))
        if best is None or score > best[0]:
            best = (score, run, longest)

    if best is None:
        if max_samples < MIN_SAMPLES:
            reason = "近恒流连续段不足 30 个有效采样点"
            if invalid_time:
                reason += "；记录中还存在重复或倒退的时间戳"
        elif max_span < MIN_VOLTAGE_SPAN:
            reason = "近恒流段电压覆盖不足 0.10 V"
        else:
            reason = "5 mV 分箱后，连续有效差分不足 20 个；可能存在采样稀疏、噪声或工况切换"
        return unavailable(reason, max_samples, max_span, max_bins)

    _, selected, values = best
    smoothed = []
    half_window = SMOOTH_BINS // 2
    for index, (voltage, _) in enumerate(values):
        nearby = [row[1] for row in values[max(0, index - half_window):index + half_window + 1]]
        smoothed.append([round(voltage, 5), round(sum(nearby) / len(nearby), 6)])
    return {"status": "ready", "reason": None, "sample_count": len(selected),
            "voltage_span_V": round(max(row[1] for row in selected) -
                                    min(row[1] for row in selected), 4),
            "voltage_range_V": [round(min(row[1] for row in selected), 4),
                                round(max(row[1] for row in selected), 4)],
            "derivative_bins": len(values), "points": smoothed}


def incremental_capacity(cycle):
    times = cycle.get("time_in_s")
    currents = cycle.get("current_in_A")
    if vector_length(times) is not None and vector_length(times) == vector_length(currents):
        peak = max((abs(number) for raw in currents
                    if (number := finite(raw)) is not None), default=0)
        cutoff = max(1e-9, peak * 0.02)
        signs = {}
        for raw_time, raw_current in zip(times, currents):
            time, current = finite(raw_time), finite(raw_current)
            if time is None or current is None or abs(current) < cutoff:
                continue
            signs[time] = signs.get(time, 0) | (1 if current > 0 else 2)
        if sum(value == 3 for value in signs.values()) >= 10:
            reason = "至少 10 个时间戳同时记录相反方向电流，无法可靠分离充放电阶段"
            return {
                "method": method(),
                "charge": unavailable(reason),
                "discharge": unavailable(reason),
            }
    return {
        "method": method(),
        "charge": phase_curve(cycle, "charge"),
        "discharge": phase_curve(cycle, "discharge"),
    }


def method():
    return {"basis": "all_original_samples", "voltage_bin_V": BIN_V,
            "smoothing_bins": SMOOTH_BINS, "minimum_samples": MIN_SAMPLES,
            "minimum_derivative_bins": MIN_DERIVATIVE_BINS,
            "current_tolerance_fraction": CURRENT_TOLERANCE,
            "discharge_sign": "-dQ/dV"}
