# Data Model: Online Artifact Preview

No database entities or migrations are introduced.

## Existing entities used

### Experiment artifact

The preview APIs resolve an artifact ID through the existing artifact repository and file contract. Existing fields continue to define its experiment association, filename, kind, availability, directory status, and relative file key.

Preview constraints:

- Directories are not previewable.
- Text preview is limited to the supported text suffix set, valid UTF-8 content, and 1 MiB.
- Model preview is limited to formats supported by the bundled Netron viewer.
- The artifact file and metadata are never changed by preview.

### Experiment input

The existing immutable experiment configuration and split manifest are displayed in read-only mode. Their stored text remains unchanged; no new persistence is needed.

### Experiment result

The provider may rewrite its best-result file during training. The scheduler imports the terminal file after process exit. If an interim result snapshot already exists for an active experiment, the new snapshot is published as the next immutable result version and becomes the current result head.

## Transient preview state

The selected artifact ID and preview kind exist only in the browser while the preview dialog is open. This state is not persisted.
