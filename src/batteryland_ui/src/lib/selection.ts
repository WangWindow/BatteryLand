import type { Battery, DataSource, SelectionRow } from "../api/types"

export type Selection = Record<string, SelectionRow>
export function includes(selection: Selection, battery: Pick<Battery, "id" | "source_id">): boolean {
  const item = selection[battery.source_id]
  if (!item) return false
  return item.include_all
    ? !item.excluded_battery_ids?.includes(battery.id)
    : Boolean(item.battery_ids?.includes(battery.id))
}
export function sourceSelection(current: Selection, source: DataSource, selected: boolean): Selection {
  const next = { ...current }
  if (selected)
    next[source.id] = {
      source_id: source.id,
      expected_revision: source.revision,
      include_all: true,
      battery_ids: [],
      excluded_battery_ids: [],
    }
  else delete next[source.id]
  return next
}
export function batterySelection(
  current: Selection,
  battery: Battery,
  source: DataSource,
  selected: boolean,
): Selection {
  const item = current[source.id] ?? {
    source_id: source.id,
    expected_revision: source.revision,
    include_all: false,
    battery_ids: [],
    excluded_battery_ids: [],
  }
  const list = new Set(item.include_all ? item.excluded_battery_ids : item.battery_ids)
  if (selected === !item.include_all) list.add(battery.id)
  else list.delete(battery.id)
  const next = {
    ...current,
    [source.id]: {
      ...item,
      ...(item.include_all ? { excluded_battery_ids: [...list] } : { battery_ids: [...list] }),
    },
  }
  if (!item.include_all && !list.size) delete next[source.id]
  return next
}
export function countSelection(selection: Selection, sources: DataSource[]): number {
  return Object.values(selection).reduce((sum, item) => {
    const source = sources.find((candidate) => candidate.id === item.source_id)
    return (
      sum +
      (item.include_all
        ? Math.max(0, (source?.available_battery_count ?? 0) - (item.excluded_battery_ids?.length ?? 0))
        : (item.battery_ids?.length ?? 0))
    )
  }, 0)
}
