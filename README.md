# datto-rmm-api-client

[![npm version](https://img.shields.io/npm/v/datto-rmm-api-client.svg)](https://www.npmjs.com/package/datto-rmm-api-client)
[![Validate](https://github.com/pncit/datto-rmm-api-client/actions/workflows/validate.yml/badge.svg)](https://github.com/pncit/datto-rmm-api-client/actions/workflows/validate.yml)
[![license](https://img.shields.io/npm/l/datto-rmm-api-client.svg)](./LICENSE)

A server-side TypeScript client for the [Datto RMM](https://www.datto.com/products/rmm/) REST API v2. It handles OAuth2 token management, pagination, rate limiting, and runtime response validation so consumers can call the API without reimplementing that plumbing.

## Features

- **Token management** — OAuth2 password-grant authentication with automatic in-memory caching and refresh; no manual token juggling.
- **Automatic pagination** — `getAccountDevices()` walks every page and returns a single flat array.
- **Runtime validation** — every response is checked against [Zod](https://zod.dev) schemas, with a configurable [validation mode](#validation-modes) that controls how strictly (or loosely) drift from the schema is enforced.
- **`Result<T>` everywhere** — API methods never throw for expected failure modes (HTTP errors, rate limits, validation failures). Callers check `result.ok` instead of wrapping every call in `try`/`catch`.
- **Client-side rate limiting & retries** — a sliding-window limiter and configurable retry count guard against exceeding Datto RMM's API limits.
- **Pluggable logger and HTTP client** — bring your own logger (anything with `debug`/`info`/`warn`/`error`) or your own configured Axios instance.
- **Fully typed** — the `Device` type and every schema behind it are exported for reuse in your own code and tests.

## Requirements

Node.js >= 20. This package is **ESM-only** (`"type": "module"`) — it does not ship a CommonJS build, so it must be imported (`import`), not `require`d.

## Install

```bash
npm install datto-rmm-api-client
```

## Quick start

```ts
import { createDattoRmmClient } from "datto-rmm-api-client";

const client = createDattoRmmClient({
  apiUrl: "https://concord-api.centrastage.net", // your Datto RMM API region URL
  apiKey: process.env.DATTO_RMM_API_KEY!,
  apiSecret: process.env.DATTO_RMM_API_SECRET!,
});

const result = await client.getAccountDevices();

if (!result.ok) {
  console.error("Failed to fetch devices:", result.error);
  process.exit(1);
}

for (const device of result.value) {
  console.log(device.hostname, device.online ? "online" : "offline");
}

// Devices that failed schema validation (strict mode) are reported here,
// not thrown — the rest of the account's devices are still returned.
if (result.warnings?.length) {
  console.warn(`${result.warnings.length} device(s) skipped due to validation errors`);
}
```

`apiUrl` is the base URL for your Datto RMM platform region (e.g. `concord-api`, `pinotage-api`, `zinfandel-api`, etc. — see your Datto RMM UI under **Admin > API**), and `apiKey`/`apiSecret` are the API credentials generated there.

## API

### `createDattoRmmClient(config)`

Returns a `DattoRmmClient`. Equivalent to `new DattoRmmClient(config)`.

| Option | Type | Default | Description |
|---|---|---|---|
| `apiUrl` | `string` | — *(required)* | Base URL of your Datto RMM API region |
| `apiKey` | `string` | — *(required)* | API key, used as the OAuth2 username |
| `apiSecret` | `string` | — *(required)* | API secret, used as the OAuth2 password |
| `validationMode` | `"strict" \| "warn" \| "off"` | `"strict"` | Controls response validation — see [Validation modes](#validation-modes) |
| `logger` | `{ debug, info, warn, error }` | `console` | Receives validation warnings/errors; pass your own structured logger |
| `rateLimit` | `{ requestsPerWindow?, windowSeconds? }` | `{ 600, 60 }` | Client-side sliding-window request limit |
| `retry` | `{ maxAttempts? }` | `{ maxAttempts: 3 }` | Attempts per request before returning a failed `Result` |
| `axiosInstance` | `AxiosInstance` | internal `axios.create()` | Use your own configured Axios instance (proxies, interceptors, etc.) |

### `DattoRmmClient` methods

| Method | Returns | Description |
|---|---|---|
| `getAccountDevices(params?)` | `Promise<Result<Device[]>>` | Fetches every device on the account, walking pagination automatically. `params` is passed through as query parameters on the first request. |
| `getDeviceByUid(deviceUid)` | `Promise<Result<Device>>` | Fetches a single device by its UID. |
| `updateDeviceUdfs(deviceUid, udf)` | `Promise<Result<void>>` | Patches a device's user-defined fields (`udf1`–`udf30`). Accepts a partial object. |
| `invalidateToken()` | `void` | Drops the cached access token, forcing a refresh on the next request. |

## `Result<T>` and error handling

Every API method returns a `Result<T>` instead of throwing:

```ts
type Result<T> =
  | { ok: true; value: T; warnings?: ProblemError[] }
  | { ok: false; error: ProblemError };
```

`ProblemError` describes what went wrong (`type`, `title`, `status`, and an optional `detail`), covering HTTP failures, rate limiting, and validation errors alike. Check `result.ok` before reading `value` or `error`:

```ts
const result = await client.getDeviceByUid(uid);
if (!result.ok) {
  // result.error.type is one of: "http-error", "network-error", "rate-limit", "validation-error"
  return handleError(result.error);
}
useDevice(result.value);
```

## Validation modes

Every response is checked against this package's `Device` schema. `validationMode` controls what happens when a response doesn't match:

- **`strict`** *(default)* — On `getAccountDevices()`, a device that fails validation is excluded from the returned array and reported in `result.warnings[]` as a `ProblemError` identifying the device (`id`/`uid`) and the field that diverged; the rest of the account's devices are still returned. On `getDeviceByUid()`, where there's no larger batch to salvage from, a validation failure fails the call (`result.ok === false`). A structurally malformed response (not a per-device issue, but an unrecognizable page shape) always fails the call, in both `strict` and `warn`.
- **`warn`** — Non-conforming responses are passed through unvalidated (raw) rather than dropped or failed, with the drift logged via your configured `logger` at `warn` level.
- **`off`** — No validation at all. Responses are passed through exactly as received.

In every mode, validation diagnostics are logged through your configured `logger`, never `console` directly.

## Rate limiting & retries

A sliding-window limiter tracks requests over the configured window (defaults to 600 requests / 60 seconds). A request that would exceed the window fails immediately with a `rate-limit` `ProblemError` rather than queuing. Failed requests (network errors, non-2xx responses) are retried up to `retry.maxAttempts` times before the call returns a failed `Result`.

## Exported types

In addition to `DattoRmmClient` and `createDattoRmmClient`, the package exports:

- `DattoRmmClientConfig` — the client configuration shape
- `Result`, `ProblemError` — the result/error types described above
- `Device`, `DeviceSchema` — the device type and its backing Zod schema, along with the nested schemas that compose it (`AntivirusSchema`, `PatchManagementSchema`, `UdfSchema`, `DevicesTypeSchema`), useful for validating fixtures in your own tests

## License

MIT © PNC IT
