# Artifact Preview API Contract

The complete versioned API contract is generated in [the current backend OpenAPI contract](../../012-backend-service-protocol/contracts/core-openapi.json). These endpoints extend that single-port API.

## Text artifact

`GET /api/v1/artifacts/{artifact_id}/preview/text`

- Returns UTF-8 `text/plain` for an available registered text artifact.
- Allows only the text formats defined by the backend preview policy.
- Rejects directories, unsupported formats, invalid UTF-8, NUL-containing content, and content over 1 MiB using the standard error envelope.
- Response uses `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.

## Model viewer document

`GET /api/v1/artifacts/{artifact_id}/preview/model`

- Returns a local HTML document loading Netron's bundled viewer assets from the same API origin.
- The viewer document identifies one registered supported model artifact and does not proxy artifact bytes to an external host.
- Response uses `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.

## Model data

`GET /api/v1/artifacts/{artifact_id}/preview/model/data/{filename}`

- Returns the selected registered model file as `application/octet-stream` for the embedded viewer.
- The requested filename must equal the registered artifact name; path resolution remains governed by the existing artifact file contract.
- Response uses `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.

## Bundled viewer assets

`GET /api/v1/netron-assets/{asset_path}` is an internal browser asset route and is omitted from the public OpenAPI schema. It resolves paths inside the installed Netron package and does not expose Python source files.
