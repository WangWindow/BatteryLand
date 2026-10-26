# Research: Online Artifact Preview

## Decision 1: Serve Netron from the existing API origin

- **Decision**: Use the Netron Python package's bundled browser assets, served through FastAPI, and point the viewer at the registered local artifact's preview-data route.
- **Rationale**: This adds no server process or port, keeps model weights local, and reuses the model viewer requested for common model formats.
- **Alternatives considered**: A separately hosted Netron service would add deployment and port management. A third-party hosted viewer would transfer user model data outside the local application.

## Decision 2: Use an explicit allowlist and bounded reads for text previews

- **Decision**: Preview a limited list of text formats only, require UTF-8-compatible content, reject NUL bytes, and cap reads at 1 MiB.
- **Rationale**: Output folders may contain binary and large files; suffix plus content checks avoid treating arbitrary output as text and bounded reads avoid loading unbounded files into the UI.
- **Alternatives considered**: Inferring arbitrary content types or returning the whole file would make binary handling and memory use unpredictable.

## Decision 3: Use CodeMirror with the GitHub theme for configuration and read-only views

- **Decision**: Use a single lightweight editor wrapper with YAML/JSON language modes and an explicit read-only mode. Keep editing enabled only in the existing configuration workflow.
- **Rationale**: This provides a consistent code-focused presentation while preserving the current config validation/save path and preventing artifact mutation.
- **Alternatives considered**: Retaining plain textareas or preformatted blocks would not deliver syntax support or the requested GitHub theme. Replacing the existing form-driven config workflow is outside scope.

## Decision 4: Preserve the existing artifact model

- **Decision**: Preview by artifact ID via the current artifact service and filesystem contract. Do not persist preview state or add database columns.
- **Rationale**: Preview is a transient view of an existing registered artifact; existing IDs, paths, and availability remain authoritative.
- **Alternatives considered**: New preview records or copied files would duplicate state without helping retrieval.

## Decision 5: Import the final result only after process exit

- **Decision**: Collect live logs and metrics during training, then import the final result after process termination. If an earlier result snapshot already exists for an active run, publish the next immutable result version rather than rejecting the final snapshot.
- **Rationale**: The provider updates `best_result.json` while training. Treating an early snapshot as immutable final output raises a conflict on later epochs; because output collection precedes the scheduler's finish event, that conflict leaves the experiment in `running` after its process exits.
- **Alternatives considered**: Mutating an existing result document would violate immutable document versioning. Letting output collection errors abort the terminal transition can leave completed experiments permanently marked as running.
