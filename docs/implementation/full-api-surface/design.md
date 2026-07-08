# Full API Surface Design

Tracking: None

## Problem Statement

`datto-rmm-api-client` ships at `0.1.14` with a well-built infrastructure layer but almost no API
coverage. Three operations are implemented — `getAccountDevices`, `getDeviceByUid`,
`updateDeviceUdfs` — against a Datto RMM v2 surface of **53 paths / 75 operations** across ten
resource groups. Consumers who need anything beyond listing devices (sites, alerts, jobs, audits,
variables, filters, users, activity logs, or any write operation) must fall back to raw HTTP,
forfeiting the client's auth, retry, rate-limiting, and validation.

The gap is not only breadth. The one hand-written schema is already **wrong against production
data**, and silently so:

- `DeviceSchema.udf` models `udf1…udf30`; real devices carry `udf1…udf300`. UDFs 31–300 are
  invisible to consumers today.
- `deviceClass` omits the real value `rmmnetworkdevice`, so a network device fails validation.
- Timestamp fields are the correct `number` by luck of hand-tuning, but nothing prevents the next
  hand-written schema from drifting.

Hand-transcribing ~113 schemas and 75 operations to close the gap would multiply this class of
error. The API is large enough, and its published OpenAPI specification defective enough (detailed
in [Current State](#current-state)), that the transcription itself is the risk. Meanwhile a sibling
PNCIT package — `fuze-api` — has already solved this exact problem (Orval-generated zod schemas, a
lenient validation layer, resource namespaces, a typed error hierarchy) and diverges from this
client only by historical accident.

The cost of inaction: the client stays a device-listing utility, every new endpoint is a manual
schema-transcription task with a standing chance of a silent data defect, and two PNCIT API clients
drift further apart in shape and mental model.

## Vision

`datto-rmm-api-client` becomes a **complete, generated, type-safe** client for the Datto RMM v2 API
that a developer can use for any documented operation with runtime validation, faithful rate
limiting, and a typed error model. Its schemas are **generated from Datto's OpenAPI specification**
and reconciled against observed production reality, so coverage tracks the API and correctness does
not depend on hand-transcription. Its architecture **mirrors `fuze-api`**: the two PNCIT clients
share one mental model, one logger contract, and reusable validation patterns.

### Goals

- Cover the entire v2 surface (R1) behind ergonomic resource namespaces (R2).
- Generate schemas from the committed spec (R4, R15) and reconcile the spec's systematic defects so
  validation matches production reality (R5, R8).
- Converge on `fuze-api`'s architecture: throwing error hierarchy (R9), lenient response validation
  (R5, R7), strict request validation (R6), Orval codegen, tsup/vitest tooling (R16), and a
  fuze-parallel logger (R13).
- Model the real server rate-limit contract faithfully (R11, R12).
- Ship as a documented, breaking `1.0.0` (R18, R19).

### Non-Goals

- **Cross-platform / domain normalization.** This client exposes validated *wire* shapes. Mapping
  Datto entities into a normalized cross-platform model is `fuze-api`'s responsibility, not this
  low-level client's.
- **Browser / edge-runtime support.** The client remains ESM-only, server-side, Node ≥ 20.
- **Any non-v2 endpoints.** Only the v2 API (`/api/v2/**`) and its OAuth token endpoint are in
  scope.
- **Automatic recovery from a 403 IP-block.** A 403 is surfaced; the client does not attempt to wait
  out or work around a block.
- **Log-masking of secret-bearing fields beyond UDFs.** The stakeholder masking decision (R20) is
  scoped to `udf*` values, which frequently hold secrets. Other fields that *may* carry sensitive
  data — masked site/account `variables`, free-text `Site.notes` — are **not** masked by the client;
  a consumer that logs those is responsible for redacting them. This boundary is deliberate, so the
  masking guarantee is exactly "no UDF value in cleartext," not an open-ended secret-scrubber.

## Requirements

| ID | Requirement | Kind | Source |
|----|-------------|------|--------|
| R1 | The client exposes **every** Datto RMM API v2 operation — all 53 paths / 75 operations across `account`, `site`, `device`, `alert`, `job`, `filter`, `audit`, `user`, `activity-logs`, `system` — covering both reads and writes. | Functional | Scope decision (full read + write) |
| R2 | Operations are organized as **resource namespaces**: `client.<resource>.<operation>()` (e.g. `client.devices.get(uid)`, `client.alerts.resolve(uid)`). | Functional | API-shape decision |
| R3 | Paginated collections transparently walk `pageDetails.nextPageUrl` and return the **full** result set. The `pageDetails` envelope is validated **strictly** enough that a malformed/absent cursor **throws** `DattoValidationError` rather than silently truncating the walk; response leniency applies to the named-array items, not the walk cursor. | Functional | Existing pagination behavior, generalized |
| R4 | Response and request schemas are **zod v4 schemas generated by Orval** from a committed OpenAPI spec (two targets: types + `.zod.ts`). | Functional | Convergence / codegen decision |
| R5 | **Response** validation is **lenient**: unknown keys are stripped and logged, all fields are tolerated as nullable/optional (the spec carries no reliable presence/nullability information), and **enum-typed fields degrade to passthrough** — an unobserved value is logged but widened to `string` rather than failing the item. | Non-functional | Reality findings |
| R6 | **Request** bodies are validated **strictly** before sending: unknown keys are rejected and present fields are type-checked. Because the spec declares almost no `required` fields, required-field enforcement is **not** spec-derivable and is instead added for the small write set in the override module. | Functional | fuze-api pattern |
| R7 | Collection responses validate **per-item**: invalid items are dropped and logged without failing the whole response. | Functional | Resilient-validation heritage |
| R8 | Known spec defects are corrected deterministically and **survive regeneration**: timestamps as integer epoch-ms; UDFs across the full `udf1…udf300` range (as a record); `alertContext` as a permissive `@class`-tagged object. | Functional | Reality findings |
| R9 | Failures are signaled by **throwing** typed errors — `DattoApiError` (HTTP/transport), `DattoValidationError` (schema) — over a shared `BaseError`. The `Result<T>`/`ProblemError` contract is removed. | Functional | Convergence decision |
| R10 | The client authenticates via OAuth2 password grant and manages token lifecycle (cache + proactive refresh before expiry). | Functional | Existing behavior |
| R11 | Local rate limiting models the real server model: read bucket 600/60s, aggregate write 600/60s, and **per-operation write sub-limits** (`device-udf-set` 600, other writes 100). | Non-functional | `system/request_rate` findings |
| R12 | The client honors server **429 `Retry-After`** in backoff and surfaces **403 IP-block** as a clear error without auto-retry. | Functional | Rate-limit decision |
| R13 | Config accepts an **optional injected logger whose interface mirrors fuze-api's `FuzeLogger`** — `debug/info/warn/error`, each `(message: string, meta?: Record<string, unknown>) => void`, validated by a zod schema and defaulting to a console-backed implementation. It is the sink for validation-leniency, rate-limit, and token diagnostics. | Functional | Logger decision — mirror fuze-api |
| R14 | `userAgentExtra` sets a `User-Agent` header; `tokenRefreshPct` drives refresh timing; config fields that earn no keep (`autoRefresh`) are removed. | Functional | Dead-config decision |
| R15 | The OpenAPI spec is committed (`spec/openapi.json` + a previous copy for diffing); the patched spec (`spec/openapi.patched.json`) and `src/generated/**` are **regenerated build artifacts, not committed**. `npm run generate` runs the deterministic patch step then Orval, so re-running it reproduces `src/generated/**` byte-for-byte from the committed inputs; generated output is never hand-edited. | Non-functional | fuze-api pattern |
| R16 | Build uses **tsup**; tests use **vitest + nock**; the package stays ESM-only, Node ≥ 20, publishing `dist` + types. | Non-functional | Convergence decision |
| R17 | Generated + reconciled schemas are verified against **real captured response fixtures**. | Non-functional | Reality-data corpus |
| R18 | A comprehensive public **README** documents install, auth setup, per-namespace usage, error handling, logger injection, validation leniency, and rate-limit config. | Functional | Stakeholder request |
| R19 | Released as a breaking **1.0.0** with **no** backward-compat aliases for the retired 0.1.x methods. | Non-functional | Compat decision |
| R20 | Any log output that could include UDF values **masks** each non-null UDF value as `[redacted - N characters]` (N = length of the original string); UDF values are never emitted to the logger in cleartext. | Non-functional (security) | Stakeholder decision — UDFs frequently hold secrets |

## Current State

### The client today

The package is ESM-only, Node ≥ 20, built with `tsc`, tested with `jest`/`ts-jest`, and depends on
`axios` and `zod` (imported as `zod/v4`). `DattoRmmClient` (`src/client.ts`) composes a layered
infrastructure that is genuinely reusable:

- `AuthManager` (`src/auth.ts`) — OAuth2 password grant against `{apiUrl}/auth/oauth/token` with HTTP
  basic `public-client:public`; caches a token in an in-memory `InMemoryTokenStore` and refreshes
  when within 60 s of expiry.
- `HttpClient` (`src/httpClient.ts`) — wraps an axios instance, acquires a rate-limit slot per
  request, retries up to `maxAttempts`, and maps failures through `mapAxiosError`.
- `SlidingWindowRateLimiter` (`src/rateLimiter.ts`) — a **single** 600/60 s sliding window; write
  operations are not modeled separately.
- Validation (`src/validation.ts`) — `validate` (single value) and `validateItems` (per-item
  partition) over three modes `strict | warn | off`, plus `toProblemError`/`firstIssuePath` helpers.
- `Result<T>` / `ProblemError` (`src/result.ts`) — a **non-throwing** result contract; every public
  method returns `Result<T>` and never throws for an API or validation failure.
- `src/client.ts` exposes a generic `getAllPages<T,P>()` walker over `pageDetails.nextPageUrl`, and
  the three public methods. `getAllPages` is close to reusable but is hard-wired to a devices
  envelope and extractor.

The public surface (`src/index.ts`) re-exports `client`, `config`, `result`, and `schemas`. Only
`DeviceSchema` and the devices envelope exist (`src/schemas.ts`, `src/internal/devicesEnvelope.ts`).

Two concrete correctness gaps exist today: `updateDeviceUdfs` targets
`PATCH /api/v2/account/devices/{uid}/udf`, but the documented endpoint is `POST /api/v2/device/{uid}/udf`;
and `DeviceSchema` diverges from production as described in the Problem Statement.

Config fields `autoRefresh`, `tokenRefreshPct`, and `userAgentExtra` are declared in
`DattoRmmClientConfig` but unused in code.

### The reference architecture: `fuze-api`

`fuze-api` (sibling repo) is a mature PNCIT client that already embodies the target architecture:

- **Orval 7**, two targets — an axios/types target emitting `src/generated/types/` and endpoint
  stubs, and a **zod** target emitting `src/generated/schemas/<tag>/<tag>.zod.ts` with
  `coerce: { date }` and `strict.response: false`. The spec is committed at `spec/openapi.json`
  (with `spec/openapi-prev.json` retained for diffing) and regenerated via `npm run generate`.
- **`src/validation/schema-leniency.ts`** — a `parseLenient(schema, data, logger?, context?)` that
  recursively applies `.catchall(z.unknown())` to every object node, then walks the parse output to
  strip and log unknown keys. All zod-v4 internals (`_zod.def`) are isolated to this module.
- **`src/client/resources/base-resource.ts`** — a `BaseResource` with `get`/`post`/`patch`/
  `deleteRequest` primitives and `validateRequest` (strict, throws), `validateResponse` (lenient,
  throws), and `validateArrayResponse` (per-item, drops + logs invalid items). Each resource
  (`CompanyResource`, …) extends it; the client exposes them as namespaces.
- A typed error hierarchy: `BaseError` → `FuzeApiError` (status, response body, correlation id) and
  `FuzeValidationError` (zod error, `'request' | 'response'` stage, optional wire payload).
- `FuzeLogger` — an optional, zod-validated structured logger `(message, meta?) => void` for
  `debug/info/warn/error`.
- Built with **tsup**, tested with **vitest + nock**.

`fuze-api`'s only material disagreement with this client is the error contract (it throws; this
client returns `Result<T>`), plus build/test tooling. It consumes a well-formed spec (generated from
zod via `zod-openapi`), so it never had to confront the defect profile below.

### The Datto RMM v2 OpenAPI specification and its defects

The machine-readable spec is served (unauthenticated for the document itself) at
`{apiUrl}/api/v3/api-docs/Datto-RMM`: OpenAPI 3.1.0, **53 paths, 113 component schemas**. Fetches
from two regions (`vidal`, `zinfandel`) are **semantically identical** — the only differences are the
`servers[].url` host and a meaningless key-ordering swap in one schema (`MailRecipient`). The spec is
therefore **region-invariant**; region only changes the base URL a consumer supplies as `apiUrl`.

Every collection response uses a uniform envelope `{ pageDetails, <namedArray> }` with a shared
`PaginationData` (`count`, `totalCount`, `prevPageUrl`, `nextPageUrl`). Named arrays are
`sites`/`devices`/`users`/`variables`/`alerts`/`activities`/`components`/`filters`, etc.

The spec is **systematically defective** — established by a full read-only sweep of a live account
(848 devices, 61 sites, 20 users, 118 components, 78 open + 1500 resolved alerts, device/site/audit
detail), profiled field-by-field against the spec:

1. **Nullability is entirely unmodeled.** Zero `nullable`/`null` unions across 782 property
   definitions; only 4 of 113 schemas declare any `required` array. Yet production returns `null`
   pervasively — including nullable booleans (`Device.a64Bit`, `Component.credentialsRequired`) and
   fields null in every observed row (`Site.notes`, `Site.proxySettings`). A schema generated
   verbatim would be *stricter than reality* and reject valid responses.
2. **Timestamps are typed `string` but are `number` (epoch-ms) in reality** — every one:
   `Device.lastSeen/lastReboot/lastAuditDate/creationDate`, `AuthUser.created/lastAccess`,
   `Alert.timestamp/resolvedOn`.
3. **UDFs span `udf1…udf300`** in both the spec (`Udf` has 300 properties) and reality; the
   hand-written schema's 30 fields are simply incomplete.
4. **`Alert.alertContext` polymorphism is not captured.** Reality uses a Jackson `@class`
   discriminator (`comp_script_ctx`, `eventlog_ctx`, `patch_ctx`, `antivirus_ctx`,
   `online_offline_status_ctx`, `perf_resource_usage_ctx`, …) whose actual fields match **none** of
   the spec's ~30 `*Context` schema property names. Those generated `*Context` schemas are dead for
   validation.

Enum coverage is otherwise good: 25 enums are present and accurate (`antivirusStatus`, `patchStatus`,
`deviceClass` including `rmmnetworkdevice`), so generation preserves real enums — the reconciliation
burden for *content* is nullability, timestamps, UDFs, and alert context, not enums. Enum
*completeness*, however, cannot be proven from a finite sweep: the 848-device account establishes the
observed values, not the closed set. A future server-side value (a new `deviceClass`, `patchStatus`)
is therefore treated as a runtime possibility, not a validation error (R5).

### The real rate-limit model

`GET /api/v2/system/request_rate` on the live account reveals a model richer than the human docs
("reads 600, writes 100"): a read limit `600`/60 s at `0.9` cutoff, an **aggregate** write limit
`600`, **and per-operation write sub-limits** in `operationWriteStatus` — most `100`
(`site-create`, `alert-resolve`, `device-move`, `device-job-create`, variable mutations,
`user-reset-keys`, proxy/warranty), but **`device-udf-set` is `600`**. The endpoint is queryable, so
the client can read its actual server-side budget rather than only estimating locally.

## Proposed Design

### Overview

Rebuild `datto-rmm-api-client` as a generated, throwing, namespace-organized client that mirrors
`fuze-api`. Orval generates zod v4 schemas and TypeScript types from a committed, defect-corrected
OpenAPI spec. A `BaseResource` provides validated HTTP primitives; one `*Resource` class per
resource group exposes the operations as `client.<resource>.<operation>()`. Responses validate
leniently, requests strictly. Failures throw a typed error hierarchy. A dual-layer rate limiter
models the real read/write/per-operation contract. The `Result<T>` contract, three validation
modes, single-bucket limiter, `tsc` build, and `jest` tests are all retired.

```
spec/openapi.json ──(patch step)──▶ spec/openapi.patched.json ──(Orval)──▶ src/generated/{types,schemas}
                                                                                     │
overrides (src/schema-overrides.ts) ── reconcile udf / alertContext / nullability ───┤
                                                                                     ▼
BaseResource (get/post/patch/delete + validateRequest/Response/ArrayResponse)  ◀── AuthManager, RateLimiter, HttpClient
        │
        ├── AccountResource   ├── DeviceResource   ├── SiteResource    ├── AlertResource
        ├── JobResource       ├── AuditResource    ├── FilterResource  ├── UserResource
        ├── ActivityLogResource                    └── SystemResource
                                    │
                          DattoRmmClient (namespaces) ── throws DattoApiError / DattoValidationError
```

### Key Concepts

- **Generated schema layer** (`src/generated/**`, R4, R15) — Orval output: `src/generated/types/`
  (TS types) and `src/generated/schemas/<tag>/<tag>.zod.ts` (zod validators). Overwritten on every
  `npm run generate`; never hand-edited.
- **Spec-patch step** (R8, R15) — a committed script transforms `spec/openapi.json` into
  `spec/openapi.patched.json` *before* Orval, fixing structural defects generation cannot infer:
  timestamp fields `string → integer`, and `Alert.alertContext` replaced with a permissive open
  object carrying `@class`. The patched spec is a regenerated artifact (the *script* is committed, its
  output is not); the transform is deterministic, so `npm run generate` reproduces the patched spec
  and therefore `src/generated/**` byte-for-byte from the committed `spec/openapi.json`.
- **Schema-override module** (`src/schema-overrides.ts`, R8) — where a per-field patch is clearer
  than a spec transform (e.g. representing `Udf` as a `z.record(/^udf\d+$/, z.string().nullable())`
  rather than 300 literal keys), a small hand-maintained module wraps the generated schema. It also
  carries the **required-field marks for the write-request bodies** (R6): the spec's near-empty
  `required` arrays mean generated request schemas are almost entirely optional, so `.strict()` alone
  would accept an empty `device-move`/`udf-set` body — the override module marks the genuinely
  required fields of the small write set (one place, hand-verified against the endpoint docs). Imports
  generated schemas; is imported by resources. Survives regeneration because it lives outside
  `src/generated/`.
- **Lenient response parsing** (`src/validation/schema-leniency.ts`, R5, R7) — `parseLenient`
  ported from `fuze-api`, extended so that **response** validation also tolerates
  null/absent values on any field (the spec cannot be trusted for presence) **and widens every
  enum-typed field to accept an unknown value** (each generated enum is unioned with `string` on the
  response side, logging the unseen value rather than failing the item). Unknown keys are
  stripped and logged; array items validate independently and drop-and-log on failure. Enum widening
  is deliberate: without it, per-item drop (R7) would silently discard any record carrying a
  future server enum value — re-creating the exact `rmmnetworkdevice` silent-data-loss failure the
  Problem Statement condemns. Enums stay strict on **request** bodies, where the client controls the
  value.
- **`BaseResource`** (`src/client/resources/base-resource.ts`, R2, R6, R7) — validated
  `get`/`post`/`patch`/`deleteRequest` primitives plus `validateRequest` (strict),
  `validateResponse` (lenient), `validateArrayResponse` (per-item), and a `paginate` helper (R3)
  that walks `pageDetails.nextPageUrl`, validating each page's named array with `validateArrayResponse`.
  The `pageDetails` cursor itself is validated **strictly** (not leniently): a malformed or absent
  `pageDetails` throws `DattoValidationError` instead of ending the walk early and returning a partial
  set — leniency governs the item payloads, never the walk-control cursor.
- **Resource namespaces** (R1, R2) — one class per resource group extending `BaseResource`, surfaced
  on `DattoRmmClient` as `account`, `sites`, `devices`, `alerts`, `jobs`, `audit`, `filters`,
  `users`, `activityLogs`, `system`.
- **Typed error hierarchy** (`src/errors/**`, R9) — `BaseError` → `DattoApiError`
  (status, response body, request id) and `DattoValidationError` (zod error, `'request' | 'response'`
  stage, optional wire payload), parallel to `fuze-api`.
- **`DattoLogger`** (R13) — a fuze-parallel structured logger interface (`debug/info/warn/error`,
  `(message, meta?) => void`), zod-validated, optional, console-default.
- **UDF log masking** (R20) — a masking utility applied to any payload before it reaches the logger,
  replacing every non-null `udf*` value with `[redacted - N characters]` (N = the original string
  length). It is invoked wherever a UDF-bearing payload could be logged — the leniency diagnostics
  (dropped items, unknown-key warnings) and any debug payload logging — so a UDF value never appears
  in cleartext in a log line. Masking preserves the surrounding structure so a redacted log stays
  diagnostically useful (which fields were present, how long the value was).
- **Dual-layer rate limiter** (R11, R12) — a read sliding window (600/60 s), an aggregate write
  window (600/60 s), and per-operation write windows keyed by the operation name Datto reports in
  `operationWriteStatus` (e.g. `device-udf-set` → 600, `alert-resolve` → 100). The classification
  reaches the limiter through the request path: each `BaseResource` primitive tags the request with a
  `{ kind: 'read' | 'write', opKey? }` descriptor (read primitives default to `kind: 'read'`; each
  write method passes its `opKey`), `HttpClient.acquire()` receives that descriptor in the request
  options and selects the buckets, and the limiter enforces the tightest applicable window (read
  bucket for reads; aggregate-write **and** the op-key window for writes). This replaces the current
  context-free `acquire()` signature.

### Design Decisions

#### Decision 1: Mirror `fuze-api`'s architecture rather than extend the current client

**Decision:** Adopt `fuze-api`'s Orval codegen, `parseLenient`, `BaseResource` + resource
namespaces, throwing error hierarchy, and tsup/vitest tooling. Retire this client's `Result<T>`
contract, three-mode validation, single-bucket limiter, `tsc`, and `jest`. (R2, R4, R9, R16)

**Rationale:** The two PNCIT clients should share one mental model, one logger contract, and one set
of validation patterns; a developer moving between them should not re-learn error handling.
`fuze-api` has already built and hardened the exact components this expansion needs, so convergence
*reduces* net new code (port `parseLenient` and `BaseResource` rather than invent them). The client
is young (`0.1.x`, three methods), so the cost of switching its error contract is near its minimum
now and rises with every consumer added later. A breaking `1.0.0` is already accepted (R19).

**Alternatives considered:**
- *Extend the current client, keep `Result<T>` and three modes (the earlier "hybrid" position).*
  Rejected once `fuze-api` was examined: it leaves two PNCIT clients with divergent error contracts
  (throwing vs. `Result`), so `fuze-api`'s throwing `BaseResource` cannot be reused verbatim and the
  shared-mental-model goal is lost. The only thing it preserves — the `Result` contract — is exactly
  what the convergence decision judged not worth preserving.
- *Fully generate the entire client (client + methods) from the spec.* Rejected: generators emit a
  throwing, tag-class client with no lenient validation, no rate limiting, and no OAuth lifecycle,
  and — given the spec's defects — would validate against fiction. Generation is the right tool for
  *schemas*, not for the behavior layer.

#### Decision 2: Generate schemas from a defect-corrected spec, reconciled to production reality

**Decision:** Treat the generated schema layer as a skeleton over a defective spec. A committed
spec-patch step fixes structural defects before Orval (timestamps `string → integer`, `alertContext`
→ permissive object); a small override module handles per-field cases better expressed in code (UDF
record); and **response** validation is lenient about nullability and unknown keys. Request bodies
validate strictly. (R4, R5, R6, R8)

**Rationale:** The spec is accurate on structure and enum *content* but *systematically wrong* on
nullability (zero modeled; pervasive in reality), timestamp types, UDF representation ergonomics, and
alert context — and it cannot prove enum *completeness* from any finite sweep. Verbatim generation
would reject real responses in strict mode, and strict enums would silently drop (via R7) any record
carrying a future server-side enum value; so response validation widens enums to passthrough (union
with `string`, log the unseen value) while keeping them strict on requests. Splitting the fix by kind —
spec-patch for structural/type defects that belong to the schema shape, override module for
ergonomics, lenient parsing for the unpredictable and pervasive nullability — keeps each mechanism
small and each concern in one place, and every mechanism lives outside `src/generated/` so
regeneration never clobbers it (R15). Blanket response leniency is defensible precisely because the
upstream contract provides no reliable presence information; strict *request* validation is safe
because the client controls request shapes.

**Alternatives considered:**
- *Accept generated schemas verbatim.* Rejected: rejects real responses (nullability), mis-types
  timestamps, and drops UDFs 31–300 / mis-models alert context.
- *Hand-annotate every nullable field in an override module.* Rejected: 782 properties with
  pervasive, data-dependent nullability makes per-field annotation both enormous and perpetually
  stale; recursive response leniency covers it in one place.
- *Fix defects by editing the committed spec directly.* Rejected: the spec is an upstream artifact
  refreshed from Datto; hand-edits would be lost or conflict on refresh. Corrections must be a
  reproducible transform (patch step) applied to the fetched spec, and `spec/openapi-prev.json` lets
  a refresh diff be inspected (R15).

#### Decision 3: Model the real read / aggregate-write / per-operation rate-limit contract

**Decision:** Replace the single sliding window with a read window (600/60 s), an aggregate write
window (600/60 s), and per-operation write windows keyed by Datto's `operationWriteStatus` names;
each write operation declares its key. Honor server `429 Retry-After` in backoff; surface `403`
IP-block as a `DattoApiError` without auto-retry. (R11, R12)

**Rationale:** The live `system/request_rate` contract is materially different from the human docs
and from the current single bucket: writes have both an aggregate ceiling and per-operation ceilings,
and `device-udf-set` (600) is six times the common write ceiling (100). A single 600 bucket would let
bursts of `alert-resolve` (real limit 100) sail past the local guard and get 429'd or 403'd by the
server; a uniform 100 write bucket would needlessly throttle `device-udf-set`. Modeling the real
tiers keeps the client inside the server's actual budget. Honoring `Retry-After` is the server's
explicit instruction; a 403 block is a stateful penalty the client cannot safely race, so it is
surfaced, not worked around (a Non-Goal).

**Alternatives considered:**
- *Read + single write bucket (100 uniform).* Rejected: over-throttles `device-udf-set` and ignores
  the aggregate-vs-per-operation distinction.
- *Read + aggregate-write only (no per-operation windows).* Rejected: misses the common case — a
  burst of one 100-limited operation type staying under the 600 aggregate but exceeding its own
  ceiling.
- *Rely solely on server 429s (no local limiter).* Rejected: persistent violations escalate to a
  403 IP-block (5-minute penalty); local limiting exists to avoid provoking it.

#### Decision 4: Retire the `Result<T>` contract in favor of a throwing error hierarchy

**Decision:** Public methods return the validated value directly and **throw** `DattoApiError` /
`DattoValidationError` (over `BaseError`). `Result<T>` and `ProblemError` are removed. (R9)

**Rationale:** Convergence with `fuze-api` (Decision 1) requires one error model; `fuze-api` throws.
Throwing also yields simpler call sites for the common path (`const d = await client.devices.get(uid)`)
and a typed `catch` for failures, consistent across both PNCIT clients.

**Alternatives considered:**
- *Keep `Result<T>`.* Rejected under Decision 1 — it is the specific divergence convergence exists to
  eliminate.
- *Support both (throw + a `Result`-returning variant).* Rejected: two parallel surfaces double the
  API and the tests for no benefit the typed `catch` doesn't already provide.

#### Decision 5: Resource namespaces over a flat method set

**Decision:** Expose operations as `client.<resource>.<operation>()` via one `*Resource` class per
group, extending `BaseResource`. The three retired methods map to `client.devices.get(uid)`,
`client.account.devices()`, and `client.devices.setUdf(uid, udf)` (the last realigned to the correct
`POST /api/v2/device/{uid}/udf`). (R1, R2)

**Rationale:** 75 operations on one object is unnavigable; grouping by resource matches the API's own
tag structure, `fuze-api`'s layout, and IDE discoverability. `BaseResource` centralizes the
validated HTTP + pagination plumbing so each resource class is thin.

**Alternatives considered:**
- *Flat methods (current style).* Rejected: 75 same-level methods, poor discoverability, and
  divergence from `fuze-api`.
- *Back-compat aliases for the three old methods.* Rejected per R19 — a clean `1.0.0` break; aliases
  would also carry the wrong UDF endpoint forward.

### Public surface

```ts
const client = createDattoRmmClient({
  apiUrl: "https://zinfandel-api.centrastage.net",
  apiKey, apiSecret,
  logger,            // optional DattoLogger
  userAgentExtra,    // optional
  tokenRefreshPct,   // optional
  rateLimit, retry,  // optional
});

const device   = await client.devices.get(uid);          // throws on failure
const devices  = await client.account.devices();          // full pagination
await client.devices.setUdf(uid, { udf5: "…" });          // strict request validation
const alerts   = await client.alerts.openForSite(siteUid);
await client.alerts.resolve(alertUid);
const rate     = await client.system.requestRate();
```

Namespaces and their groups: `account`, `sites`, `devices`, `alerts`, `jobs`, `audit`, `filters`,
`users`, `activityLogs`, `system` — collectively covering all 53 paths (R1). `src/index.ts` exports
`createDattoRmmClient`, `DattoRmmClient`, the config and logger types, the error classes, and the
generated types.

## Migration Strategy

This is a full internal rebuild published as `1.0.0`. There is no in-place data migration; the
migration is for **consumers** of the `0.1.x` API and for the repository tooling.

Sequence (phase boundaries for the Planner, not prescriptions):

1. Tooling: add Orval + config (two targets), tsup, vitest + nock; remove `tsc`-as-build and jest.
2. Spec pipeline: commit `spec/openapi.json` (fetched from `/api/v3/api-docs/Datto-RMM`) and
   `spec/openapi-prev.json`; add the patch step and `npm run generate`; generate `src/generated/**`.
3. Foundation: port `schema-leniency`, `BaseResource`, the error hierarchy, and `DattoLogger`;
   extend the rate limiter to the dual/per-operation model; wire config changes (R14).
4. Resources: implement the ten `*Resource` classes and mount them on `DattoRmmClient`.
5. Overrides + fixtures: add `src/schema-overrides.ts`; capture real-response fixtures; write
   validation tests (R17).
6. Docs + release: rewrite the README (R18); bump to `1.0.0` (R19).

### Breaking Changes

- **Every public method changes.** `getAccountDevices` / `getDeviceByUid` / `updateDeviceUdfs` are
  removed in favor of namespaced operations (Decision 5); `updateDeviceUdfs`'s endpoint is also
  corrected.
- **Error contract changes** from returned `Result<T>` to thrown `DattoApiError` /
  `DattoValidationError` (Decision 4); the `Result`/`ProblemError` exports are removed.
- **Validation-mode config removed** (`strict | warn | off`); response leniency is the model (R5).
- **Config fields changed** (R14): `autoRefresh` removed; `userAgentExtra` and `tokenRefreshPct`
  become functional.
- **Logger interface changes** (R13): from the variadic `LoggerLike` (`(...args: any[]) => void`,
  defaulting to `console`) to the zod-validated `DattoLogger` (`(message: string, meta?) => void` per
  level). A `0.1.x` consumer passing a `console`-style logger must adapt; the README documents a thin
  shim in the upgrade path.

The README documents the `0.1.x → 1.0.0` upgrade path for each of these (R18).

### Data Migration

None. No persisted state; the in-memory token store is unchanged in behavior.

## Success Criteria

- All 53 paths / 75 operations are reachable through resource namespaces (R1, R2), each with a
  generated request/response schema (R4).
- Real-response fixtures (the captured account data) validate through the reconciled schemas without
  error, exercising leniency (nullability, unknown keys, per-item drop) (R5, R7, R8, R17).
- Strict request validation rejects malformed bodies before an HTTP call (R6).
- No log line emitted by the client contains a UDF value in cleartext; masked values read
  `[redacted - N characters]` with the correct length, verified by a test that logs a UDF-bearing
  payload and asserts the sink never saw the raw value (R20).
- A write burst that would exceed a per-operation limit is throttled locally per the correct tier
  (R11); a simulated `429` with `Retry-After` is honored and a `403` surfaces without retry (R12).
- `npm run generate` reproduces `src/generated/**` byte-for-byte from the committed spec (R15).
- The README covers install, auth, every namespace, error handling, logger injection, leniency, and
  rate limiting (R18); the package publishes as ESM `1.0.0` with `dist` + types (R16, R19).

### Verification

```bash
npm run generate     # regenerate; git diff of src/generated must be empty (R15)
npm run typecheck    # tsc --noEmit across generated + hand code (R16)
npm run lint
npm test             # vitest + nock: fixture, leniency, rate-limit, error, UDF-masking tests (R5,R7,R11,R12,R17,R20)
npm run build        # tsup → dist (R16)
```

### What Stays the Same

- OAuth2 password-grant auth and in-memory token caching (R10).
- ESM-only, server-side, Node ≥ 20 (R16).
- The consumer supplies the region base URL as `apiUrl`; schemas are region-invariant.
- Publishing shape: `dist` + `.d.ts`, public access.

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Spec refresh reintroduces or shifts a defect (new field, moved timestamp) the patch step doesn't cover | Medium | Medium | `spec/openapi-prev.json` diff on every refresh; fixture-based validation tests (R17) fail loudly when reality drifts from schemas; patch step is data-driven and documented. |
| Orval zod-v4 output requires internal (`_zod.def`) access that a zod minor bump breaks | Medium | Medium | Isolate all zod-internal access to `schema-leniency.ts` (as `fuze-api` does); pin zod; cover leniency with unit tests. |
| Blanket response nullability leniency masks a genuinely missing required field | Medium | Low | Leniency is response-only; requests stay strict (R6); per-item drops are logged (R7) so absence is observable, not silent. |
| `alertContext` permissive object gives consumers weak typing for a rich structure | Medium | Low | Document the `@class` discriminator and observed shapes in the README (R18); the generated `*Context` schemas remain available as opt-in references; can be tightened later without a break. |
| Per-operation write limits are more granular than fits a clean API | Low | Medium | Limiter keys off Datto's own operation names; each resource declares its key in one place; `system.requestRate()` (R11) lets consumers reconcile against the server. |
| Printer/ESXi audit and proxy-settings schemas are unverified (absent from the sampled account) | Medium | Low | Flagged as spec-derived-only; leniency tolerates their real shapes; README notes them as unverified; add fixtures when such devices are available. |
| Full rebuild is large for one release | Medium | Medium | Phased migration with independent, testable phases; infrastructure (auth, http) is reused, not rewritten. |
| Real-response fixtures (R17) contain live secrets — UDFs observed to hold BitLocker recovery keys, admin usernames, credentials — that must not be committed, nor leaked to logs at runtime | High | High | At rest: fixtures are sanitized before commit — redact/synthesize secret-bearing fields (notably `udf*`) while preserving type/nullability shape; a documented sanitization step gates fixture capture; never commit raw sweep output. At runtime: UDF log masking (R20) keeps UDF values out of log output. |

## Future Considerations

### Enabled by This Design

- New Datto endpoints are added by refreshing the spec and regenerating — coverage tracks the API.
- The generated types + zod schemas can back higher-level consumers (including `fuze-api`'s Datto
  integration) without re-describing the wire format.
- `system.requestRate()` enables adaptive client-side throttling driven by real server budget.

### Deferred Decisions

- **Tightening `alertContext` into a typed discriminated union** keyed on `@class`: deferred until
  the full set of context shapes is characterized from production; the permissive object is correct
  and non-breaking to refine later.
- **Printer/ESXi audit and proxy-settings schema hardening**: deferred until an account with such
  devices is available to ground-truth; spec-derived schemas plus leniency suffice until then.
- **OAuth flows beyond password grant**: out of scope; the documented Datto flow is password grant.

### Open Questions

None — every question and assumption this design depends on was resolved before finalizing.
