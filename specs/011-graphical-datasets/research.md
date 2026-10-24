# Research: 图形化数据集创建与划分

## Decision: Reuse the existing source and split entities

- **Decision**: A registered `DataSource` represents a default physical dataset. A versioned `Split` represents a user-created logical dataset and already stores the complete selected member set through its three partitions.
- **Rationale**: `SplitService` already validates source ownership, resolves parent-battery families, enforces no cross-partition leakage, supports manual/random/hybrid strategies, and publishes immutable versions used by experiments.
- **Alternatives considered**: Adding a separate `Dataset` entity would duplicate split names, membership, versioning, and experiment references without adding a distinct lifecycle in this slice.

## Decision: Use backend preview results for the actual family-aware split

- **Decision**: Add a preview use case that calls the same domain split algorithm as create/update and returns exact per-partition counts plus the source revision used. Keep manual/random/hybrid rules on the server.
- **Rationale**: The backend assigns whole parent-child families, so front-end count estimates from battery totals or ratios can be wrong. A source revision lets create/update reject a stale preview if new battery rows were registered between preview and save.
- **Alternatives considered**: Reimplementing the shuffle and family grouping in TypeScript would duplicate a domain rule and risk preview/save disagreement. Sending all IDs from the browser would make “use whole source” impractical for large sources.

## Decision: Compute version-keyed summaries from registered metadata

- **Decision**: Compute whole-set and partition summaries from the `Battery` metadata records used by a split. Persist the summary in a SQLite projection keyed by the immutable split document version. Backfill older versions when first read, without mutating their immutable document payload.
- **Rationale**: Statistics remain stable for historical splits, reads do not scan raw data folders, and a failed write cannot publish a split version without its matching summary. The projection can be queried directly by the later comparison feature.
- **Alternatives considered**: Recomputing on every comparison would repeatedly load battery metadata. Adding a second database or mutable Redis cache would introduce another service and an additional source of truth. Editing old split documents would violate document immutability and checksum semantics.

## Decision: Preserve typed values and missing data

- **Decision**: Summarize JSON scalar attributes. Numeric attributes use valid/missing counts and min/max/mean. Other scalar attributes use typed value counts. Null attributes count as missing; arrays/objects count as unsupported. Boolean values are categorical, not numeric.
- **Rationale**: The project supports user-defined scalar metadata and must not turn missing or unsupported values into zero. The representation can support numeric and categorical comparison without assuming a fixed attribute vocabulary.
- **Alternatives considered**: Flattening nested data or forcing every value to text can merge distinct types and create arbitrary semantics. Reading pickle files would add unsafe parsing and training dependencies to metadata browsing.

## Decision: Keep the page restrained and reuse current API patterns

- **Decision**: Replace the large split dialog with a right-side editor. Use named source cards, a paginated battery picker, a three-partition visual summary, accessible ratio controls, and explicit preview/save steps. Keep the existing split list, history, and export actions.
- **Rationale**: This keeps the workflow visual while preserving familiar, tested operations and clear loading/error states.
- **Alternatives considered**: Drag-and-drop-only assignment would be harder to operate by keyboard and would not scale well for long battery lists. A single large text form repeats the current usability problem.

## Research inputs

- Read the current `DataSource`, `Battery`, `Split`, and `SplitMember` SQLAlchemy mappings, the split domain algorithm, `SplitService`, and the split/resource API routers.
- Inspected `SplitsPage`, `ResourcesPage`, `ComparisonPage`, and the current basic difference analyzer.
- Read the BatteryLand constitution and existing SQLite document-version contract.
- Local code review resolved all technical unknowns; no external technology selection is needed. Three read-only reviews independently confirmed the entity reuse, family-aware preview, and metadata-backed summary boundaries.
