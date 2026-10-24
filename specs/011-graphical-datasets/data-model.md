# Data Model: 图形化数据集创建与划分

## Existing entities reused

### DataSource

Represents one configured physical dataset source.

- `id`: stable UUID.
- `name`: user-facing dataset name.
- `root_alias`: configured source identity; no absolute path is returned.
- `revision`: incremented only when new battery rows are added; preview/save use it to reject a stale whole-source selection.
- `battery_count`: query projection returned by the paginated list API; not stored as a duplicate counter.
- `availability`: configured source availability.

### Battery

Represents one registered file in a source.

- `id`: stable UUID.
- `source_id`: required source foreign key.
- `file_name`: display name.
- `relative_key`: source-scoped file reference.
- `parent_battery_id`: optional relation used to group related batteries for leakage prevention.
- `metadata`: arbitrary JSON object. Statistical inputs are scalar values only.

### Split document version

Represents one immutable logical dataset and its complete partition assignment.

- `id`, `version`, and `source_id`: stable version identity and source association.
- `train`, `val`, `test`: complete battery ID lists; their union is the logical dataset member set.
- `method`, `seed`, `algorithm_version`, and `parameters`: reproducibility metadata.
- A later edit creates a new document version; previous versions remain addressable.

## New projection

### DatasetStatisticsRow

One rebuildable profile for one split document version.

- `document_id`: primary key and foreign key to the immutable split document version.
- `schema_version`: integer identifying the statistics contract.
- `summary`: SQLite JSON object with four scopes: `all`, `train`, `val`, `test`.
- Each scope contains `sample_count` and an `attributes` map.
- Each attribute includes `kind`, `valid_count`, `missing_count`, and `unsupported_count`.
- Numeric attributes additionally include `min`, `max`, and `mean`.
- Categorical attributes include JSON scalar value/count pairs with a `value_type` tag so `true`, `1`, and `"1"` remain distinct.

The profile key is the document ID rather than the mutable split ID, so profile history follows exact split versions. New profiles are persisted with split header/member rows in the same unit-of-work transaction. Existing split versions without a profile can be backfilled on first detail read without editing their checksummed document payload.

## Validation rules

- A logical dataset references exactly one registered source.
- In selected mode, the battery list is nonempty, unique, known, and belongs to that source.
- In whole-source mode, the server resolves all registered members for that source; the browser does not submit an unbounded identity list.
- `expected_source_revision` is required for preview and save and must match the source revision at that moment.
- Manual assignment must include every selected member exactly once. Random assignment cannot contain fixed members. Hybrid assignment may fix a subset and deterministically distribute the rest.
- Parent-battery roots must remain within a single partition.
- Ratios are finite, between zero and one, and sum to one; the seed is an integer in `[0, 2**32-1]`.
- For statistics, null/missing values increment `missing_count`; object/list values increment `unsupported_count`; booleans are categorical; finite numbers are numeric; strings and mixed scalar fields are categorical.
- Profile payloads contain only finite JSON values. Empty partitions have `sample_count: 0` and empty attributes; no synthetic values are inserted.
