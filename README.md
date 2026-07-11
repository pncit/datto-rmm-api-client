# datto-rmm-api-client

[![npm version](https://img.shields.io/npm/v/datto-rmm-api-client.svg)](https://www.npmjs.com/package/datto-rmm-api-client)
[![Validate](https://github.com/pncit/datto-rmm-api-client/actions/workflows/validate.yml/badge.svg)](https://github.com/pncit/datto-rmm-api-client/actions/workflows/validate.yml)
[![license](https://img.shields.io/npm/l/datto-rmm-api-client.svg)](./LICENSE)

A server-side TypeScript client for the [Datto RMM](https://www.datto.com/products/rmm/) REST API
v2. It covers the entire documented v2 surface (53 paths / 57 operations across ten resource
namespaces), handles OAuth2 token management, pagination, rate limiting, and runtime response
validation, and throws typed errors instead of returning a result wrapper.

Its schemas are **generated** from Datto's own OpenAPI specification (`spec/openapi.json`,
committed) rather than hand-transcribed, with a small set of deterministic corrections applied for
the specification's known defects (see [Validation](#validation) below). This client shares its
architecture — generated Zod schemas, a throwing error hierarchy, an injectable structured logger —
with its sibling PNCIT package, `fuze-api`.

## Features

- **Full API coverage** — every namespace (`account`, `sites`, `devices`, `alerts`, `jobs`,
  `audit`, `filters`, `users`, `activityLogs`, `system`) covering all 53 paths / 57 operations, both
  reads and writes. See the [namespace → endpoint map](#namespaces--endpoint-map).
- **Token management** — OAuth2 password-grant authentication with automatic in-memory caching and
  proactive refresh before expiry.
- **Automatic pagination** — every collection method (e.g. `client.account.devices()`) walks
  `pageDetails.nextPageUrl` and returns the full result set.
- **Throwing error model** — API methods throw `DattoApiError` (HTTP/transport failures) or
  `DattoValidationError` (schema failures) instead of returning a `Result<T>` wrapper.
- **Generated, reconciled schemas** — request/response validation is generated from Datto's own
  OpenAPI spec and corrected for its documented defects (missing UDF range, wrong `deviceClass`
  values, mistyped timestamps, unmodeled `alertContext` polymorphism). See
  [Validation](#validation).
- **Client-side rate limiting & retries** — a dual-layer limiter (read window + aggregate/
  per-operation write windows) modeled on Datto's real server-side budget, plus exponential-backoff
  retries that honor `429 Retry-After`.
- **Pluggable, UDF-masking logger** — bring your own logger (`debug`/`info`/`warn`/`error`); every
  log call is routed through a masking decorator that redacts UDF values before they ever reach it.
- **Optional HTTP observer** — an `httpObserver` seam lets a compliance/audit pipeline watch every
  raw HTTP exchange (request, response/error, duration) without ever touching axios. See [Observing
  HTTP exchanges](#observing-http-exchanges-httpobserver).
- **Fully typed** — every namespace, request body, and response entity is exported for reuse in
  your own code and tests.

## Requirements

Node.js >= 20. This package is **ESM-only** (`"type": "module"`) — it does not ship a CommonJS
build, so it must be imported (`import`), not `require`d.

## Install

```bash
npm install datto-rmm-api-client
```

## Quick start

```ts
import {
  createDattoRmmClient,
  DattoApiError,
  DattoValidationError,
} from "datto-rmm-api-client";

const client = createDattoRmmClient({
  apiUrl: "https://zinfandel-api.centrastage.net", // your Datto RMM API region URL
  apiKey: process.env.DATTO_RMM_API_KEY!,
  apiSecret: process.env.DATTO_RMM_API_SECRET!,
});

try {
  const devices = await client.account.devices(); // walks every page, returns the full array
  for (const device of devices) {
    console.log(device.hostname, device.deviceClass);
  }

  // Response validation is lenient about presence (see Validation below), so `uid` is typed
  // `string | undefined` even though it's almost always present — handle the gap explicitly
  // rather than force-unwrapping it.
  const firstUid = devices[0]?.uid;
  if (!firstUid) {
    throw new Error("account has no devices with a uid");
  }
  const one = await client.devices.get(firstUid);
  if (!one.uid) {
    throw new Error("device has no uid");
  }
  await client.devices.setUdf(one.uid, { udf5: "asset tag 1234" });
} catch (err) {
  if (err instanceof DattoApiError) {
    console.error(`Datto API error (${err.statusCode}):`, err.message);
  } else if (err instanceof DattoValidationError) {
    console.error(`Validation failed (${err.stage}):`, err.prettyMessage);
  } else {
    throw err;
  }
}
```

`apiUrl` is the base URL for your Datto RMM platform region (e.g. `concord-api`, `pinotage-api`,
`zinfandel-api`, etc. — see your Datto RMM UI under **Admin > API**), and `apiKey`/`apiSecret` are
the API credentials generated there. The client authenticates via OAuth2 password grant
(`apiKey`/`apiSecret` as the grant's username/password) and caches the resulting access token,
refreshing it proactively before it expires.

## `createDattoRmmClient(config)`

Returns a `DattoRmmClient`. Equivalent to `new DattoRmmClient(config)`. `config` is validated on
construction (`.strictObject` — an unknown key, including a retired `0.1.x` field, throws a
`DattoValidationError` immediately rather than being silently ignored).

| Option            | Type                                                   | Default                                                           | Description                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiUrl`          | `string`                                               | — _(required)_                                                    | Base URL of your Datto RMM API region.                                                                                                                                      |
| `apiKey`          | `string`                                               | — _(required)_                                                    | API key, used as the OAuth2 password-grant username.                                                                                                                        |
| `apiSecret`       | `string`                                               | — _(required)_                                                    | API secret, used as the OAuth2 password-grant password.                                                                                                                     |
| `logger`          | `DattoLogger`                                          | a `console`-backed logger                                         | Receives validation, rate-limit, and retry diagnostics. Every call is UDF-masked before reaching it — see [Logger injection & UDF masking](#logger-injection--udf-masking). |
| `userAgentExtra`  | `string`                                               | —                                                                 | Optional suffix appended to the client's default `User-Agent` header.                                                                                                       |
| `tokenRefreshPct` | `number` (0–100)                                       | `25`                                                              | Refresh the cached token once fewer than this percentage of its original TTL remains.                                                                                       |
| `retry`           | `{ maxAttempts?, baseDelayMs?, maxDelayMs? }`          | `{ maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 5000 }`          | Exponential-backoff retry policy for transport errors and 5xx responses. Any omitted field falls back to the default.                                                       |
| `rateLimit`       | `{ readLimit?, writeAggregateLimit?, windowSeconds? }` | `{ readLimit: 600, writeAggregateLimit: 600, windowSeconds: 60 }` | Overrides for the committed rate-limit table (see [Rate limiting & retries](#rate-limiting--retries)). Per-operation write ceilings are not overridable.                    |

There is no `axiosInstance` (or `validationMode`) option: the client always constructs its own
axios instance so the auth/rate-limit/retry stack is guaranteed to be wired, and response
validation is always the leniency model described below — there is no strict/warn/off toggle.

## Namespaces & endpoint map

Operations are grouped as `client.<namespace>.<method>()`. Naming rule: **plural** for collection
namespaces (`sites`, `devices`, `alerts`, `jobs`, `filters`, `users`, `activityLogs`); **singular**
for the genuine singletons `account` and `system`, and for `audit` (a group of audit-_fetch_
operations, one per device class, rather than a collection of audit records).

The list vs. single/mutate split is explicit in the namespace, not the method name — e.g.
`client.account.devices()` returns every device on the account (paginated), while
`client.devices.get(uid)` fetches (and `client.devices.setUdf`/`.move`/… mutates) one device.

### `client.account`

| Method                             | HTTP   | Path                                             |
| ---------------------------------- | ------ | ------------------------------------------------ |
| `get()`                            | GET    | `/api/v2/account`                                |
| `devices(params?)`                 | GET    | `/api/v2/account/devices` (paginated)            |
| `variables(params?)`               | GET    | `/api/v2/account/variables` (paginated)          |
| `createVariable(body)`             | PUT    | `/api/v2/account/variable`                       |
| `updateVariable(variableId, body)` | POST   | `/api/v2/account/variable/{variableId}`          |
| `deleteVariable(variableId)`       | DELETE | `/api/v2/account/variable/{variableId}`          |
| `components(params?)`              | GET    | `/api/v2/account/components` (paginated)         |
| `dnetSiteMappings(params?)`        | GET    | `/api/v2/account/dnet-site-mappings` (paginated) |

### `client.sites`

| Method                                          | HTTP   | Path                                                           |
| ----------------------------------------------- | ------ | -------------------------------------------------------------- |
| `list(params?)`                                 | GET    | `/api/v2/account/sites` (paginated)                            |
| `get(siteUid)`                                  | GET    | `/api/v2/site/{siteUid}`                                       |
| `create(body)`                                  | PUT    | `/api/v2/site`                                                 |
| `update(siteUid, body)`                         | POST   | `/api/v2/site/{siteUid}`                                       |
| `devices(siteUid, params?)`                     | GET    | `/api/v2/site/{siteUid}/devices` (paginated)                   |
| `devicesWithNetworkInterface(siteUid, params?)` | GET    | `/api/v2/site/{siteUid}/devices/network-interface` (paginated) |
| `variables(siteUid, params?)`                   | GET    | `/api/v2/site/{siteUid}/variables` (paginated)                 |
| `createVariable(siteUid, body)`                 | PUT    | `/api/v2/site/{siteUid}/variable`                              |
| `updateVariable(siteUid, variableId, body)`     | POST   | `/api/v2/site/{siteUid}/variable/{variableId}`                 |
| `deleteVariable(siteUid, variableId)`           | DELETE | `/api/v2/site/{siteUid}/variable/{variableId}`                 |
| `settings(siteUid)`                             | GET    | `/api/v2/site/{siteUid}/settings`                              |
| `deviceFilters(siteUid, params?)`               | GET    | `/api/v2/site/{siteUid}/filters` (paginated)                   |
| `updateProxy(siteUid, body)`                    | POST   | `/api/v2/site/{siteUid}/settings/proxy`                        |
| `deleteProxy(siteUid)`                          | DELETE | `/api/v2/site/{siteUid}/settings/proxy`                        |

> **Unverified shape:** the sampled account used to reconcile this client's schemas had no site
> with proxy settings configured, so `updateProxy`/`deleteProxy`'s request/response shapes are
> validated against the committed OpenAPI spec only, not cross-checked against real captured data
> like the rest of this table.

### `client.devices`

| Method                        | HTTP | Path                                     |
| ----------------------------- | ---- | ---------------------------------------- |
| `get(uid)`                    | GET  | `/api/v2/device/{uid}`                   |
| `getById(deviceId)`           | GET  | `/api/v2/device/id/{deviceId}`           |
| `getByMacAddress(macAddress)` | GET  | `/api/v2/device/macAddress/{macAddress}` |
| `move(uid, siteUid)`          | PUT  | `/api/v2/device/{uid}/site/{siteUid}`    |
| `createJob(uid, body)`        | PUT  | `/api/v2/device/{uid}/quickjob`          |
| `setUdf(uid, udf)`            | POST | `/api/v2/device/{uid}/udf`               |
| `setWarranty(uid, body)`      | POST | `/api/v2/device/{uid}/warranty`          |

> **Note:** `setUdf` targets `POST /api/v2/device/{uid}/udf` — corrected from the `0.1.x` client's
> `updateDeviceUdfs`, which wrongly targeted `PATCH /api/v2/account/devices/{uid}/udf`. Device-scoped
> proxy settings do not exist as a separate endpoint; proxy configuration is site-scoped
> (`client.sites.updateProxy`/`deleteProxy`).

### `client.alerts`

Every alert read and write lives here regardless of which resource scope (`account`/`site`/
`device`) the underlying Datto endpoint is tagged under, so alert handling is one place, not three.

| Method                                  | HTTP | Path                                                     |
| --------------------------------------- | ---- | -------------------------------------------------------- |
| `get(uid)`                              | GET  | `/api/v2/alert/{uid}`                                    |
| `resolve(uid)`                          | POST | `/api/v2/alert/{uid}/resolve`                            |
| `mute(uid)` _(deprecated by Datto)_     | POST | `/api/v2/alert/{uid}/mute`                               |
| `unmute(uid)` _(deprecated by Datto)_   | POST | `/api/v2/alert/{uid}/unmute`                             |
| `open(params?)`                         | GET  | `/api/v2/account/alerts/open` (paginated)                |
| `resolved(params?)`                     | GET  | `/api/v2/account/alerts/resolved` (paginated)            |
| `openForSite(siteUid, params?)`         | GET  | `/api/v2/site/{siteUid}/alerts/open` (paginated)         |
| `resolvedForSite(siteUid, params?)`     | GET  | `/api/v2/site/{siteUid}/alerts/resolved` (paginated)     |
| `openForDevice(deviceUid, params?)`     | GET  | `/api/v2/device/{deviceUid}/alerts/open` (paginated)     |
| `resolvedForDevice(deviceUid, params?)` | GET  | `/api/v2/device/{deviceUid}/alerts/resolved` (paginated) |

`mute`/`unmute` are implemented even though Datto's spec marks both deprecated ("Alerts can no
longer be muted/un-muted, as of the 8.9.0 release") — this client covers the full documented
surface regardless of deprecation.

### `client.jobs`

| Method                          | HTTP | Path                                              |
| ------------------------------- | ---- | ------------------------------------------------- |
| `get(uid)`                      | GET  | `/api/v2/job/{uid}`                               |
| `getResults(jobUid, deviceUid)` | GET  | `/api/v2/job/{jobUid}/results/{deviceUid}`        |
| `getStdOut(jobUid, deviceUid)`  | GET  | `/api/v2/job/{jobUid}/results/{deviceUid}/stdout` |
| `getStdErr(jobUid, deviceUid)`  | GET  | `/api/v2/job/{jobUid}/results/{deviceUid}/stderr` |
| `getComponents(uid, params?)`   | GET  | `/api/v2/job/{uid}/components` (paginated)        |

### `client.audit`

Audit-_fetch_ operations — each returns the audit for one device/printer/ESXi host, rather than a
collection of audit records (hence the singular namespace name).

| Method                                  | HTTP | Path                                                    |
| --------------------------------------- | ---- | ------------------------------------------------------- |
| `getDevice(deviceUid)`                  | GET  | `/api/v2/audit/device/{deviceUid}`                      |
| `getDeviceByMacAddress(macAddress)`     | GET  | `/api/v2/audit/device/macAddress/{macAddress}`          |
| `getDeviceSoftware(deviceUid, params?)` | GET  | `/api/v2/audit/device/{deviceUid}/software` (paginated) |
| `getPrinter(deviceUid)`                 | GET  | `/api/v2/audit/printer/{deviceUid}`                     |
| `getEsxiHost(deviceUid)`                | GET  | `/api/v2/audit/esxihost/{deviceUid}`                    |

> **Unverified shapes:** `getPrinter`/`getEsxiHost` are validated against the committed OpenAPI
> spec only — the account sampled while reconciling this client's schemas had no printer or ESXi
> devices, so these two response shapes have not been cross-checked against real captured data the
> way every other endpoint here has. Expect the normal response-leniency handling (unknown keys
> stripped, enums widened) to cover any gap, but treat an unexpected field on these two responses
> specifically as more likely than elsewhere.

### `client.filters`

| Method              | HTTP | Path                                         |
| ------------------- | ---- | -------------------------------------------- |
| `defaults(params?)` | GET  | `/api/v2/filter/default-filters` (paginated) |
| `custom(params?)`   | GET  | `/api/v2/filter/custom-filters` (paginated)  |

There are no filter write operations — Datto's spec declares only these two reads.

### `client.users`

| Method          | HTTP | Path                                |
| --------------- | ---- | ----------------------------------- |
| `list(params?)` | GET  | `/api/v2/account/users` (paginated) |
| `resetKeys()`   | POST | `/api/v2/user/resetApiKeys`         |

`resetKeys()` resets the _authenticated_ user's own API access/secret keys and returns the new pair
in the response body (there is no request body).

### `client.activityLogs`

| Method          | HTTP | Path                                |
| --------------- | ---- | ----------------------------------- |
| `list(params?)` | GET  | `/api/v2/activity-logs` (paginated) |

### `client.system`

| Method                      | HTTP | Path                          |
| --------------------------- | ---- | ----------------------------- |
| `status()`                  | GET  | `/api/v2/system/status`       |
| `requestRate()`             | GET  | `/api/v2/system/request_rate` |
| `paginationConfiguration()` | GET  | `/api/v2/system/pagination`   |

`requestRate()` returns the authenticated account's real server-side rate-limit budget — see
[Rate limiting & retries](#rate-limiting--retries) for how it relates to the client's own local
limiter.

## Pagination

Every paginated method (marked "(paginated)" above) walks `pageDetails.nextPageUrl` internally and
returns the **full** result set as a single array — there is no page-cursor argument to manage
yourself. The `pageDetails` cursor itself is validated **strictly**: a missing or malformed cursor
throws `DattoValidationError` rather than silently truncating the walk, while a `null`
`nextPageUrl` is the normal, expected end of the walk. This strictness applies only to the walk
control — the items within each page validate leniently (see [Validation](#validation)).

## Error handling

Every method throws instead of returning a result wrapper:

```ts
import { DattoApiError, DattoValidationError } from "datto-rmm-api-client";

try {
  await client.devices.get(uid);
} catch (err) {
  if (err instanceof DattoApiError) {
    // HTTP/transport failure
    console.error(err.statusCode, err.message, err.response);

    if (err.statusCode === 429) {
      // err.retryAfterMs is populated when the client gave up rather than retrying further —
      // either the server's own Retry-After exceeded the client's wait ceiling, or the client
      // exhausted retry.maxAttempts first.
    }

    if (err.statusCode === 403) {
      // Datto returns 403 for BOTH a rate-limit IP-block penalty and an ordinary authorization
      // failure (insufficient scope, revoked credentials) — the status alone doesn't
      // distinguish them. err.code disambiguates: 'ip-block' | 'forbidden'. Neither is retried
      // automatically; err.response carries the raw body so you can inspect it yourself. For an
      // 'ip-block' with a server-supplied Retry-After, err.retryAfterMs also carries the block's
      // wait hint.
    }
  } else if (err instanceof DattoValidationError) {
    // Schema failure — either an outgoing request (a body you built violates the write schema)
    // or an incoming response (in practice rare, given response leniency — see Validation).
    console.error(err.stage, err.prettyMessage, err.getErrorTree());
  } else {
    throw err; // not a client-thrown error
  }
}
```

- **`DattoApiError`** — HTTP/transport failures. `statusCode` (`0` for a transport-level failure
  with no response at all), `response` (the raw response body, if any), `requestId` (from a
  conventional response header, if present), `retryAfterMs` (set on a 429, and also on a 403
  `ip-block` when the server sends a `Retry-After`), and `code` (403 only:
  `'ip-block' | 'forbidden'`).
- **`DattoValidationError`** — Zod validation failures. `stage` (`'request' | 'response'`),
  `zodError`, `prettyMessage`, `getErrorTree()`, and `payload`/`context` when supplied.
- Both extend the exported `BaseError` (itself extending `Error`), so `instanceof Error` and
  `.stack` work as expected.

A `403` is never retried automatically (an IP block is a stateful penalty this client does not
attempt to wait out or race). A `429` is retried within `retry.maxAttempts`, honoring the server's
`Retry-After` header (in either RFC form — delta-seconds or an HTTP-date) up to a fixed 30-second
ceiling; a larger requested wait throws `DattoApiError` with `retryAfterMs` populated instead of
blocking your call for hours.

## Logger injection & UDF masking

```ts
import type { DattoLogger } from "datto-rmm-api-client";

const logger: DattoLogger = {
  debug: (message, meta) => myLogger.debug(message, meta),
  info: (message, meta) => myLogger.info(message, meta),
  warn: (message, meta) => myLogger.warn(message, meta),
  error: (message, meta) => myLogger.error(message, meta),
};

const client = createDattoRmmClient({ apiUrl, apiKey, apiSecret, logger });
```

`DattoLogger` is a structured, four-level interface — `(message: string, meta?: Record<string,
unknown>) => void` per level — validated with Zod on construction. It defaults to a
`console`-backed implementation if omitted. It is the sink for validation-leniency diagnostics
(stripped unknown keys, widened enums — at `debug`), per-item drops (at `warn` — see
[Validation](#validation)), and rate-limit/retry/token observability.

**UDF masking guarantee:** every log call made anywhere inside this client is routed through a
masking decorator before it reaches your logger. Any non-null value under a key matching
`/^udf\d+$/` — at any nesting depth, regardless of whether the value is a string, number, or nested
object/array — is replaced with `[redacted - N characters]` (`N` = the length of the original
value's string form) before your logger ever sees it. Datto RMM user-defined fields (`udf1`…
`udf300`) are known to carry secrets in practice (BitLocker recovery keys, admin usernames,
credentials), so this masking is unconditional — it applies regardless of your `logger` choice and
cannot be disabled.

This guarantee is scoped precisely to UDF values: **it does not mask any other field.** Fields that
_may_ also carry sensitive data — masked site/account `variables`, free-text `Site.notes` — are
**not** redacted by the client; if you log those, redacting them is your responsibility. Masking
also only walks a log call's `meta` object, never the message string, so the guarantee holds only
as long as call sites never interpolate a wire value into message text (this client's own code
follows that rule everywhere).

## Observing HTTP exchanges (`httpObserver`)

```ts
import type { DattoHttpObserver } from "datto-rmm-api-client";

const httpObserver: DattoHttpObserver = {
  onRequest: (e) => audit.record("request", e),
  onResponse: (e) => audit.record("response", e),
  onError: (e) => audit.record("error", e),
};

const client = createDattoRmmClient({ apiUrl, apiKey, apiSecret, httpObserver });
```

`httpObserver` is an optional, purely-observational seam for a consumer with a compliance/audit
obligation to record every outbound HTTP exchange this client makes — the capability `0.1.x`'s
inject-your-own-axios-instance approach provided, restored here without handing back the axios
instance or any way to alter the request. The client keeps full ownership of authentication, rate
limiting, retry, and pagination; `httpObserver` only watches. Omitting it changes nothing.

**⚠️ Raw, un-redacted delivery.** Unlike `logger` (masked, body/header-free), every callback here
receives the exchange exactly as sent/received — **including the `Authorization: Bearer` token on
every resource request and the API key and API secret in the OAuth token grant's request body.**
This client redacts nothing before invoking `httpObserver`; if your audit pipeline must not retain
those values, your callback is responsible for redacting them before recording the event.

- **`onRequest(event: DattoHttpRequestEvent)`** — fires immediately before an attempt is
  dispatched (after rate-limit throttling and after the `Authorization` header is attached), with
  `method`, the absolute resolved `url` (including any query string), `headers`, and `body`.
- **`onResponse(event: DattoHttpResponseEvent)`** — fires when that attempt receives a 2xx. Carries
  the same `method`/`url` as the `onRequest` event for this attempt, plus the request-side fields
  **renamed** `requestHeaders`/`requestBody` (not `headers`/`body`), plus `statusCode`,
  `responseHeaders`, `responseBody`, and `durationMs` (wire time only — throttle wait is excluded).
- **`onError(event: DattoHttpErrorEvent)`** — fires when that attempt receives any non-2xx or no
  response at all. Like `onResponse`, it carries `method`/`url` and the renamed
  `requestHeaders`/`requestBody`, plus `durationMs`. `error` is the **raw request error, typed
  `unknown`** — exactly what the transport produced, never re-derived or mapped to `DattoApiError`
  — because a `throw` guarantees nothing about its own shape. `statusCode`/`responseHeaders`/
  `responseBody` are present only when a response was actually received (absent for a
  network/timeout failure).

**Per-attempt, not per logical call.** Each callback fires once per **physical** HTTP attempt, so a
retried exchange is never collapsed into one event: a `429 → retry → 200` sequence fires
`onError` (statusCode 429) and then `onResponse` (statusCode 200) — two fully observed attempts.
The two internal exchanges `0.1.x` consumers relied on are both covered: the OAuth token
grant/refresh round-trip (`body`/`requestBody` is the raw `application/x-www-form-urlencoded`
wire string, carrying the API key) and every individual pagination page (an N-page paginated read
fires N request + N terminal events, one pair per page).

A callback that throws, or returns a rejected promise, can never alter, delay, or fail the real
request — the failure is caught, swallowed, and logged once at `warn` on your `logger` (if any).

`DattoHttpObserver` and its three named event types share one header alias, `DattoHttpHeaders`
(`Record<string, string | string[] | undefined>`) — five exported types in total, none of which
reference axios.

## Validation

Request and response schemas are generated from Datto's committed OpenAPI specification
(`spec/openapi.json`) via [Orval](https://orval.dev), reconciled against a full sweep of a live
account to correct the spec's documented defects: unmodeled nullability, timestamps typed `string`
instead of epoch-ms `number`, a UDF range that stops at `udf30` instead of `udf300`, and an
`alertContext` shape the spec doesn't actually capture. **Responses validate leniently; requests
validate strictly.**

**Response validation (lenient):**

- Unknown keys are stripped and logged at `debug` (deduped/aggregated per call — a fully-walked
  848-device page produces one summarized diagnostic, not 848 lines).
- Every field tolerates `null`/absent, regardless of what the spec claims — the spec carries no
  reliable presence information.
- Collections validate **per item**: an individual malformed item is dropped and logged at `warn`
  (aggregated into one summary per call); the rest of the collection is still returned. A drop is
  real, visible data loss — that's why it's a `warn`, distinct from the routine `debug` diagnostics
  above.
- **Enum fields degrade to passthrough.** An enum-typed field carrying a value your installed
  version of this client doesn't know about is **not** dropped — it's accepted, widened to a plain
  `string`, and logged at `debug`. This is deliberate: a strict enum would otherwise silently drop
  every record carrying a future Datto-side enum value (the exact `deviceClass: 'rmmnetworkdevice'`
  defect that motivated this rebuild — the client's own hand-written schema didn't know about it
  and rejected every network device). The corresponding TypeScript type is widened to match
  (`'known' | 'values' | (string & {})`), so the compile-time type does not claim an exhaustiveness
  the runtime deliberately relaxes — **your code must handle an enum field being a string it
  doesn't recognize.**

**Request validation (strict):** unknown keys are rejected and declared fields are type-checked
before the request is sent — the client controls what it sends, so there's no reason for leniency
there. Because Datto's spec declares almost no fields `required`, a small, hand-maintained override
module additionally marks the genuinely-required fields for each write body (e.g. `setUdf` rejects
a body with every `udf*` field omitted — a no-op write that would still consume a rate-limited write
slot for nothing).

### `alertContext`

`Alert.alertContext` is a polymorphic, Jackson-`@class`-tagged object on the wire — Datto's spec
does not model its real shape. This client validates it as a permissive object requiring only
`'@class': string`, with every other key passed through unvalidated. Observed discriminator values
include:

- `comp_script_ctx` — component/script execution context
- `eventlog_ctx` — Windows event log context
- `patch_ctx` — patch management context
- `antivirus_ctx` — antivirus status context
- `online_offline_status_ctx` — device online/offline transition context
- `perf_resource_usage_ctx` — performance/resource usage context

If you need typed access to a specific context's fields, narrow on `alertContext['@class']`
yourself; this client does not ship a typed discriminated union for it (deferred — see the design
document for why).

## Rate limiting & retries

The local limiter models Datto's real server-side budget (confirmed against
`GET /api/v2/system/request_rate`, exposed as `client.system.requestRate()`), not just the "reads
600, writes 100" summary in the human docs:

- A **read** window: 600 requests / 60 s.
- An **aggregate write** window: 600 requests / 60 s, applying to every write combined.
- **Per-operation write** windows: most writes share a 100/60 s ceiling, but `device-udf-set`
  (`client.devices.setUdf`) gets 600/60 s — six times the common ceiling.

A write consults **both** the aggregate window and its own per-operation window; a read consults
only the read window. `rateLimit` config overrides the read/aggregate-write/window-duration
scalars; per-operation ceilings are not overridable (they mirror Datto's own server-side tiers).

`client.system.requestRate()` stays available so you can reconcile the client's local limits against
your account's actual live budget, but the client never calls it itself at startup or during normal
operation — it has concrete limits from a committed table before the first request.

Failed requests are retried with exponential backoff (`retry.baseDelayMs`, doubling per attempt, up
to `retry.maxDelayMs`, capped at `retry.maxAttempts` total attempts) for network errors and 5xx
responses. A `429` is retried honoring the server's `Retry-After` (see [Error
handling](#error-handling)); a `403` is never retried (see the same section).

## Exported types

In addition to `DattoRmmClient`, `createDattoRmmClient`, and the error classes described above, the
package exports:

- `DattoRmmClientConfig`, `DattoLogger` — the config and logger shapes.
- `DattoHttpObserver`, `DattoHttpRequestEvent`, `DattoHttpResponseEvent`, `DattoHttpErrorEvent`,
  `DattoHttpHeaders` — the `httpObserver` seam's types (see [Observing HTTP
  exchanges](#observing-http-exchanges-httpobserver)).
- `Device`, `Alert` — the reconciled entity types (UDF record, open `alertContext`, widened
  open-enum fields) that `client.devices`/`client.alerts` methods actually return.
- `DeviceUdfInput`, `DeviceWarrantyInput`, `SiteVariableCreateInput`, `SiteVariableUpdateInput`,
  `AccountVariableCreateInput`, `AccountVariableUpdateInput`, `SiteProxyInput` — the validated
  input shapes the corresponding write methods accept.
- Response/query-parameter types for every other namespace (`Account`, `Site`, `Job`, `Filter`,
  `Variable`, `AuthUser`, `RateStatusResponse`, `GetSitesParams`, …) — see
  [`src/public-types.ts`](https://github.com/pncit/datto-rmm-api-client/blob/main/src/public-types.ts)
  in the repository for the complete, curated list (the published package ships only `dist` and
  its `.d.ts` files — not `src` — so `dist/index.d.ts` is the on-disk equivalent once installed).

This is a deliberately **curated** re-export, not a wildcard export of the internal generated
types — the raw generated `Device`/`Alert` shapes (literal `udf1`…`udf300` properties, the spec's
unreconciled `alertContext`) do not match what the client actually returns.

## Upgrading from 0.1.x

`1.0.0` is a full, intentionally breaking rebuild (no backward-compat aliases). If you're upgrading
from a `0.1.x` release, every one of the following changed:

1. **Every public method is replaced by a namespaced operation.**
   - `getAccountDevices()` → `client.account.devices()`
   - `getDeviceByUid(uid)` → `client.devices.get(uid)`
   - `updateDeviceUdfs(uid, udf)` → `client.devices.setUdf(uid, udf)` — **and the target endpoint
     is corrected**: the `0.1.x` client wrongly sent `PATCH /api/v2/account/devices/{uid}/udf`; this
     client correctly sends `POST /api/v2/device/{uid}/udf`.
   - `invalidateToken()` has **no replacement**. This is an unintentional capability gap, not a
     deliberate design decision: `0.1.x` let a caller proactively force a token refresh (e.g. after
     rotating `apiSecret` while a long-running process keeps its client instance alive). This
     rebuild only invalidates the cached token automatically, internally, in reaction to a `401`.
     If you relied on `invalidateToken()`, there is currently no public equivalent — construct a
     new client instead.
2. **Errors throw instead of returning `Result<T>`.** Every method that used to return `Promise<Result<T>>`
   now returns `Promise<T>` directly and throws `DattoApiError`/`DattoValidationError` on failure.
   The `Result`/`ProblemError` exports are removed entirely — wrap calls in `try`/`catch` (see
   [Error handling](#error-handling)).
3. **`validationMode` is removed.** There is no `strict | warn | off` toggle anymore — response
   validation is always lenient and request validation is always strict (see
   [Validation](#validation)); this replaces all three old modes with one consistent model.
4. **Config fields changed.** `autoRefresh` is removed (it was declared but never used in `0.1.x`).
   `userAgentExtra` and `tokenRefreshPct` were also declared-but-unused in `0.1.x`; they are now
   fully functional. There is no `axiosInstance` config option — if you injected your own axios
   instance for observability/audit purposes, see [Observing HTTP
   exchanges](#observing-http-exchanges-httpobserver) for the supported `httpObserver` replacement.
5. **The logger interface changed.** `0.1.x` accepted any variadic `LoggerLike` (`(...args: any[])
=> void`, i.e. `console`-shaped) directly. `1.0.0` requires the stricter `DattoLogger`
   (`debug/info/warn/error`, each `(message: string, meta?: Record<string, unknown>) => void`,
   Zod-validated). A thin shim for a `console`-style logger:

   ```ts
   const shim: DattoLogger = {
     debug: (m, meta) => console.debug(m, meta),
     info: (m, meta) => console.info(m, meta),
     warn: (m, meta) => console.warn(m, meta),
     error: (m, meta) => console.error(m, meta),
   };
   ```

## Maintainer runbook: capturing real fixtures

This client's test suite validates its reconciled schemas against a corpus of synthesized and real
fixtures under `tests/fixtures/`. Datto RMM user-defined fields have been observed, in practice, to
carry secrets (BitLocker recovery keys, admin usernames, credentials). **A raw captured sweep must
never be committed.**

If you capture a real response sweep (devices/sites/users/alerts/audits) from a live account to
extend the fixture corpus, sanitize it first:

```bash
node scripts/sanitize-fixtures.mjs raw-sweep.json tests/fixtures/sanitized-sweep.json
```

`scripts/sanitize-fixtures.mjs` deterministically redacts every `udf*` field (and any other
value under a fixed, documented set of secret-bearing keys) to `null`, preserving the original
type/nullability shape, so the sanitized output is safe to commit. It is **key-based**, not
content-based — it does not attempt to detect "does this value look like a secret" (an abstract
heuristic isn't reliably achievable); it redacts by field name, which is complete and predictable
for the fields it covers. This is why the raw input file should be named with a `raw-sweep.json`
suffix — `.gitignore` matches `*raw-sweep.json` at any path, so an unsanitized capture can't be
accidentally staged even if you forget to run the script first.

Real captures are also reviewed by hand at commit time as a second line of defense. This client
does not ship an automated secret-content scanner (see the design document for why: it would
false-positive on the committed OpenAPI spec's own prose and false-negative on a novel secret
shape).

## License

MIT © PNC IT
