import math
import random

from batteryland.common.errors import DomainError

PARTITIONS = ("train", "val", "test")


def make_split(
    battery_ids: list[str],
    families: dict[str, str],
    method: str,
    partitions: dict[str, list[str]] | None = None,
    ratios: dict[str, float] | None = None,
    seed: int | None = None,
) -> dict[str, list[str]]:
    selected = set(battery_ids)
    if len(selected) != len(battery_ids) or selected - families.keys():
        raise DomainError("invalid_input", "Selected batteries must be unique and known")
    if method not in {"manual", "random", "hybrid"}:
        raise DomainError("invalid_input", "Unknown partitioning method")
    groups = partitions or {name: [] for name in PARTITIONS}
    if set(groups) != set(PARTITIONS):
        raise DomainError("invalid_input", "All three partitions must be provided")
    assigned: dict[str, str] = {}
    seen: set[str] = set()
    output = {name: list(groups[name]) for name in PARTITIONS}
    for name in PARTITIONS:
        for member in output[name]:
            if member not in selected or member in seen:
                raise DomainError(
                    "invalid_input", "Partition members must be unique selected batteries"
                )
            family = families[member]
            if family in assigned and assigned[family] != name:
                raise DomainError(
                    "invalid_input", "Related samples cannot cross partition boundaries"
                )
            assigned[family] = name
            seen.add(member)
    if method == "manual":
        if seen != selected:
            raise DomainError(
                "invalid_input", "Manual partitions must assign all selected batteries"
            )
        return output
    if method == "random" and seen:
        raise DomainError("invalid_input", "Use hybrid mode for fixed members")
    if type(seed) is not int or not 0 <= seed < 2**32:
        raise DomainError("invalid_input", "A seed between 0 and 2**32-1 is required")
    if (
        ratios is None
        or set(ratios) != set(PARTITIONS)
        or any(
            type(value) not in {int, float} or not math.isfinite(value) or not 0 <= value <= 1
            for value in ratios.values()
        )
        or not math.isclose(sum(ratios.values()), 1.0, abs_tol=1e-9)
    ):
        raise DomainError("invalid_input", "Partition ratios must sum to one")
    roots = sorted({families[member] for member in battery_ids})
    unassigned = [root for root in roots if root not in assigned]
    raw_counts = {name: len(unassigned) * ratios[name] for name in PARTITIONS}
    targets = {name: math.floor(raw_counts[name]) for name in PARTITIONS}
    remaining = len(unassigned) - sum(targets.values())
    remainders = sorted(
        PARTITIONS,
        key=lambda name: (-round(raw_counts[name] - targets[name], 12), PARTITIONS.index(name)),
    )
    for name in remainders[:remaining]:
        targets[name] += 1
    random.Random(seed).shuffle(unassigned)
    position = 0
    for name in PARTITIONS:
        for root in unassigned[position : position + targets[name]]:
            assigned[root] = name
        position += targets[name]
    family_members: dict[str, list[str]] = {}
    for member in sorted(selected):
        family_members.setdefault(families[member], []).append(member)
    for root in roots:
        for member in family_members[root]:
            if member not in seen:
                output[assigned[root]].append(member)
                seen.add(member)
    return output
