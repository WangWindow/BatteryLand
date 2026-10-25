import { describe, expect, it } from "vitest"
import type { Battery, DataSource } from "../src/api/types"
import { batterySelection, countSelection, includes, sourceSelection } from "../src/lib/selection"

const source: DataSource = {
  id: "source-a",
  name: "CALCE",
  root_alias: "CALCE",
  group_prefix: "",
  revision: 3,
  battery_count: 4,
  available_battery_count: 4,
  availability: "available",
  created_at: "2026-10-25T00:00:00Z",
}
const battery = (id: string, sourceId = source.id): Battery => ({
  id,
  source_id: sourceId,
  file_name: `${id}.pkl`,
  relative_key: `${id}.pkl`,
  parent_battery_id: null,
  metadata: {},
  availability: "available",
  file_size_bytes: null,
  modified_at_ns: null,
  created_at: "2026-10-25T00:00:00Z",
})

describe("bulk battery selection", () => {
  it("selects a whole source and excludes individual files without expanding the selection", () => {
    const all = sourceSelection({}, source, true)
    expect(countSelection(all, [source])).toBe(4)

    const excludingOne = batterySelection(all, battery("battery-1"), source, false)
    expect(includes(excludingOne, battery("battery-1"))).toBe(false)
    expect(includes(excludingOne, battery("battery-2"))).toBe(true)
    expect(countSelection(excludingOne, [source])).toBe(3)
    expect(excludingOne[source.id].include_all).toBe(true)
  })

  it("adds and removes explicit file selections per source", () => {
    const one = batterySelection({}, battery("battery-1"), source, true)
    const two = batterySelection(one, battery("battery-2"), source, true)
    expect(countSelection(two, [source])).toBe(2)
    expect(includes(two, battery("battery-1"))).toBe(true)

    const removed = batterySelection(two, battery("battery-1"), source, false)
    expect(countSelection(removed, [source])).toBe(1)
    expect(includes(removed, battery("battery-1"))).toBe(false)
  })
})
