# Feature Specification: Online Artifact Preview

**Feature Branch**: `013-artifact-preview`

**Created**: 2026-10-26

**Status**: Implemented

**Input**: User description: "Allow experiment output artifacts to be previewed online with an eye control beside download; show text in a lightweight GitHub-themed editor, use the same editor for configuration, keep artifact output read-only, and use Netron for model structure previews. Keep completed experiment state current and use the same formatted JSON viewer across component and analysis views."

## User Scenarios & Testing

### User Story 1 - Inspect text artifacts (Priority: P1)

When reviewing an experiment, a user can open a supported text artifact in place, read it with syntax-aware formatting, and return to the experiment without downloading it.

**Why this priority**: Logs, configuration, manifests, and result files are common outputs and are the fastest way to understand an experiment.

**Independent Test**: Open a text artifact from an experiment, read and scroll its contents, close the preview, and confirm the artifact remains unchanged.

**Acceptance Scenarios**:

1. **Given** an available supported text artifact, **When** the user selects its preview control, **Then** the artifact opens in a GitHub-themed, read-only code view.
2. **Given** an open artifact preview, **When** the user attempts to type or paste, **Then** the displayed artifact cannot be changed.
3. **Given** an unsupported, missing, oversized, or invalid-encoding artifact, **When** the user views the artifact list or opens the preview, **Then** the UI hides the unsupported preview control or displays a clear error while retaining download where available.

---

### User Story 2 - See final experiment state and structured outputs (Priority: P1)

When training finishes, a user sees the final experiment state and result instead of a stale running state. JSON details across the experiment, component, and analysis views are readable and consistently formatted.

**Why this priority**: Users rely on the terminal state and final result to know whether an experiment completed and to inspect what it produced.

**Independent Test**: Run an experiment whose best result changes during training, wait for its process to exit, then confirm the detail page shows a terminal state and the final result. Open JSON details in the relevant views and confirm they are formatted and read-only where appropriate.

**Acceptance Scenarios**:

1. **Given** a running experiment whose intermediate result changes, **When** its process exits successfully, **Then** the experiment reaches a terminal state and exposes the last result produced by training.
2. **Given** compact JSON returned by the backend, **When** the user opens a JSON preview, **Then** it is displayed as indented, syntax-highlighted JSON without changing the stored text.
3. **Given** component details, validated split details, or dataset comparison details, **When** the user opens their JSON data view, **Then** each uses the same code presentation and is read-only.

---

### User Story 3 - Inspect model structure (Priority: P2)

When a run produces a supported model file, a user can inspect its graph and tensor structure in the experiment detail view while keeping the file within the local application.

**Why this priority**: Model structure helps users inspect training outputs without first downloading large weight files or opening a separate tool.

**Independent Test**: Open a supported model artifact, inspect the structure, close the viewer, and confirm the artifact remains unchanged and is still downloadable.

**Acceptance Scenarios**:

1. **Given** an available supported model artifact, **When** the user selects its preview control, **Then** a model structure viewer opens within the experiment page.
2. **Given** an unsupported or unavailable model artifact, **When** the artifact list is displayed, **Then** no model preview action is offered.
3. **Given** a model preview is open, **When** the user closes it, **Then** the experiment detail and artifact list remain available.

---

### User Story 4 - Edit experiment configuration clearly (Priority: P3)

When creating or editing an experiment configuration, a user can work in a readable GitHub-themed code editor; when inspecting a saved experiment, the same presentation is read-only.

**Why this priority**: A consistent code presentation improves configuration editing while preserving the submitted configuration as the source of truth for an existing run.

**Independent Test**: Edit a configuration in the configuration workflow, confirm edits are reflected in its content, then view a saved experiment configuration and confirm it cannot be changed there.

**Acceptance Scenarios**:

1. **Given** the YAML configuration editing view, **When** the user edits text, **Then** changes are reflected in the configuration workflow and remain eligible for its existing validation and save flow.
2. **Given** a saved experiment, **When** the user views its configuration, **Then** the original YAML is displayed in the GitHub-themed editor without editing capability.

### Edge Cases

- A directory artifact does not have a preview action.
- Text preview is limited to supported text formats and files no larger than 1 MiB; invalid UTF-8 and binary content are rejected.
- A file that disappears after the artifact list loads produces an understandable preview error.
- Closing the preview returns to the same experiment detail view.
- Large model files are read locally by the viewer and are not sent to a third-party service.

## Requirements

### Functional Requirements

- **FR-001**: Each available, regular artifact with a supported preview format MUST expose a preview action beside its download action.
- **FR-002**: The preview MUST keep the user on the current experiment detail page and provide a clear way to close it.
- **FR-003**: Supported text artifacts MUST be displayed in a GitHub-themed, syntax-aware viewer and MUST NOT accept edits.
- **FR-004**: Text preview MUST reject binary or invalid UTF-8 content and MUST limit a preview to 1 MiB.
- **FR-005**: Supported model artifacts MUST display their model structure in an embedded viewer without uploading artifact bytes outside the local application.
- **FR-006**: Unsupported and directory artifacts MUST remain downloadable when available but MUST NOT offer a preview action.
- **FR-007**: The experiment configuration editing workflow MUST use the GitHub-themed code editor while remaining editable and preserving its existing validation and save behavior.
- **FR-008**: A saved experiment's configuration and data split manifest MUST use the same readable presentation in read-only mode.
- **FR-009**: Previewing an artifact MUST NOT modify its stored file, artifact metadata, or experiment configuration.
- **FR-010**: The scheduler MUST publish the final available result after the training process exits and MUST allow an in-progress result snapshot to be replaced by a later snapshot while the experiment is active.
- **FR-011**: Output collection failures MUST NOT prevent the scheduler from recording a process exit and updating the experiment to a terminal state.
- **FR-012**: JSON previews and editable JSON parameters MUST use the shared code editor presentation; previews MUST be indented and read-only.

### Key Entities

- **Experiment artifact**: A registered output associated with an experiment, with a name, kind, size, availability, and a file or directory reference.
- **Experiment configuration**: The validated YAML text submitted for one immutable experiment run.
- **Preview**: A temporary read-only presentation of a supported artifact or saved experiment input; it is not a new persisted record.

## Success Criteria

### Measurable Outcomes

- **SC-001**: All available regular artifacts with supported preview formats display a preview action; unsupported and directory artifacts do not.
- **SC-002**: Every supported text artifact up to 1 MiB can be opened and read without modifying the stored artifact.
- **SC-003**: A supported model file can be inspected without transferring its contents to a third-party service.
- **SC-004**: Configuration text is editable only in the configuration workflow and read-only on a saved experiment detail page.
- **SC-005**: Within 10 seconds of a training process exiting, the experiment detail page shows a terminal state; when a final result file exists, the result shown matches it.
- **SC-006**: Every JSON detail view uses consistent indentation and syntax presentation, while stored JSON remains unchanged.

## Assumptions

- The existing artifact download registration and experiment detail APIs remain the source of artifact identity and availability.
- Preview support is intentionally limited to an explicit set of text and model file formats; unsupported artifacts remain downloadable.
- Existing experiment configuration validation and save behavior remain unchanged.
- Preview does not add persisted preview state or artifact editing operations.
