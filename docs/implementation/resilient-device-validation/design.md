# Resilient Device Validation Design

Tracking: #13

## Problem Statement

In `strict` validation mode, a **single** device that diverges from `DeviceSchema` fails the **entire** `getAccountDevices()` call for the whole account. `getAllPages()` validates each page as one unit, so one non-conforming device throws a `ZodError` that is caught and returned as `{ ok: false }` — there is no way to retrieve the other, valid devices.

This is not hypothetical. A downstream daily sync calls `getAccountDevices()` and has failed 100% for one account every day for over two weeks. Authentication and every underlying HTTP call return `200`; the account's inventory simply contains a device whose shape is stricter than `DeviceSchema` allows (a printer, ESXi host, or network device missing patch/AV data, or any device carrying a `deviceClass`/`patchStatus`/`antivirusStatus` value outside the current enums). The caller surfaces a 500. It is all-or-nothing: one odd device blocks every device.

The only workaround today is `validationMode: 'warn'`, which flows the entire raw payload through unvalidated and routes its diagnostic to `console.warn` — bypassing any logger the consumer configured, so the drift is invisible to their logging pipeline.

The cost of inaction is a standing outage for any account whose inventory drifts even slightly from the schema, and no operational signal when it happens.

## Vision

`getAccountDevices()` is resilient to per-device drift: it returns every device that conforms to `DeviceSchema` and reports every device that does not, rather than failing wholesale. A divergent device is treated as what it is — a **signal that this package's schema has drifted from upstream Datto RMM and a maintainer must reconcile it** — surfaced through the consumer's own logger at error level and returned as a structured warning, never silently dropped and never allowed to take down the account.

`strict` continues to mean strict: a device that does not match the schema is not returned. The change is that its rejection is *scoped to that device* instead of the whole call.

### Goals

- One divergent device never prevents retrieval of the account's other devices (R1).
- Rejected devices are reported to the caller as structured warnings identifying which device and which field diverged (R2).
- Validation failures reach the consumer's configured logger at error level, giving early, routable signal of schema drift (R3, R6).
- The public `Device` type and `DeviceSchema` are unchanged — no consumer is forced to add null-guards, and the schema remains the deliberate source of truth for what a valid device is (R4).

### Non-Goals

- **Relaxing `DeviceSchema` to match observed reality.** Making `patchManagement`/`antivirus`/`udf` optional or nullable, widening the closed enums, or adding `.catch()` fallbacks is explicitly out of scope. Divergence is a signal to update the schema deliberately, not to loosen it pre-emptively.
- **Changing the public `Device` type** or any exported type's shape.
- **Partial results for single-device fetches.** `getDeviceByUid()` returns one device or fails; there is no subset to salvage.
- **A new validation mode or configuration flag.** The behavior of the existing `strict`/`warn`/`off` modes is refined; no new mode is introduced.

## Requirements

| ID | Requirement | Kind | Source |
|----|-------------|------|--------|
| R1 | In `strict` mode, `getAccountDevices()` returns `{ ok: true }` with all schema-valid devices even when one or more devices diverge from `DeviceSchema`. A single divergent device must never fail the whole call. | Functional | Issue #13 fix 1 (primary goal) |
| R2 | Each device that fails `DeviceSchema` in strict mode is excluded from the returned array and recorded in `Result.warnings[]` as a `ProblemError` that identifies the device (id/uid where extractable) and the failing validation path. | Functional | Issue #13 fix 1 |
| R3 | Every dropped-device validation failure is logged at **error** level through the configured `config.logger` (`LoggerLike`), never `console` directly. | Functional | Issue #13 fix 3 + drift-signal decision |
| R4 | The public `Device` type and `DeviceSchema` are unchanged — no fields relaxed to optional/nullable, no enums widened or given catch fallbacks. | Non-functional | Type-stability decision |
| R5 | In `strict`/`warn` modes, a structurally malformed page envelope (response not an object, `devices` not an array, unparseable `pageDetails`/`nextPageUrl`) fails the call with `{ ok: false, error: { type: "validation-error" } }`. Envelope errors are protocol errors, distinct from per-device drift. Envelope validation is mode-gated and does not run in `off`, which preserves its raw-passthrough contract. | Functional | Design decision |
| R6 | `validate()` accepts the configured logger; in `warn` mode it emits its diagnostic through `logger.warn` rather than `console.warn`. | Functional | Issue #13 fix 3 |
| R7 | `getDeviceByUid()` in strict mode continues to return `{ ok: false }` on a divergent device (no partial result is possible for a single device) and logs the failure at error level through `config.logger`. | Functional | Consistency with R1/R3 |
| R8 | On the **per-device path**, `warn` and `off` modes preserve their current returned-data contract (all device data flows through, nothing dropped); only log routing changes — `warn` diagnostics go through `config.logger.warn`, `off` logs nothing. The one exception is the envelope: per R5, `warn` now hard-fails on a *malformed* envelope where it previously returned `{ ok: true, value: [] }` (see Breaking Changes). `off` runs no envelope check and is unaffected. | Non-functional | Backward compatibility |

## Current State

The client is an ESM-only TypeScript package. The relevant pieces:

**`src/validation.ts` — `validate(schema, data, mode): T`.** The single validation seam. In `off` it returns `data` uncast-checked; otherwise it `safeParse`s. On success it returns `result.data`. On failure: `strict` throws `result.error` (a `ZodError`); `warn` calls `console.warn(...)` directly and returns the raw `data`. It takes no logger — so `warn`'s diagnostic can never reach `config.logger`.

**`src/client.ts` — `getAllPages<T, P>(...)`.** Walks `pageDetails.nextPageUrl` pagination. For each page it calls `validate(schema, res.value, this.validationMode)` on the **whole page** (`DevicesPageSchema`) inside a `try`/`catch`. A `ZodError` from any device inside `devices[]` is caught and returned as `{ ok: false, error: { type: "validation-error", ... } }`, aborting the walk and discarding every already-collected and every remaining device. This is the defect: page-granular validation makes one device fatal to the account.

**`src/client.ts` — `getAccountDevices(params?)`.** Thin wrapper: gets a token, then calls `getAllPages` with `DevicesPageSchema` and an extractor `(p) => p.devices ?? []`.

**`src/client.ts` — `getDeviceByUid(uid)`.** Fetches one device and calls `validate(DeviceSchema, res.value, this.validationMode)` in a `try`/`catch` with the same `ZodError` → `{ ok: false }` handling.

**`src/schemas.ts`.** `DeviceSchema` is a closed `z.object` with `patchManagement`, `antivirus`, and `udf` **required and non-nullable**, and closed enums for `deviceClass` (`"device" | "printer" | "esxihost" | "unknown"`), `patchManagement.patchStatus`, and `antivirus.antivirusStatus`. `DevicesPageSchema = { pageDetails?: PaginationDataSchema, devices?: z.array(DeviceSchema) }`. These are exported and consumed as public types (`Device = z.infer<typeof DeviceSchema>`).

**`src/result.ts`.** `Result<T>` already carries `warnings?: ProblemError[]` on its `ok: true` branch. `ProblemError` has `type`, `title`, `status`, and optional `detail`, `errorCode`, `requestId`, `retryAfterMs`, `raw`. No type change is needed to carry rejected devices back to the caller.

**`src/logger.ts`.** `LoggerLike` has `debug`/`info`/`warn`/`error`. `config.logger` is already threaded into `HttpClient`; `defaultLogger` is `console`. The validation path is the one place a configured logger is not reachable.

**`src/config.ts`.** `DattoRmmClientConfig.logger?: LoggerLike` and `validationMode?: ValidationMode` already exist; the client defaults `validationMode` to `"strict"`.

The limitation is structural: **validation is applied at page granularity, and the sole validation seam cannot see the configured logger.** Both must change to make per-device rejection possible and observable.

## Proposed Design

### Overview

Split page validation into two concerns that are today conflated:

1. **Envelope validation** — is this a well-formed devices page (an object, `devices` an array, `pageDetails`/`nextPageUrl` readable)? A failure here is a protocol error and still fails the call (R5).
2. **Per-device validation** — does each element of `devices[]` satisfy `DeviceSchema`? A failure here is drift, scoped to that one device (R1, R2, R3).

`getAllPages` stops validating the whole page against `DevicesPageSchema`. Instead it validates the envelope with the array held as opaque elements, then validates each raw device individually. What happens to a divergent device is governed by the mode: `strict` drops it (into `warnings[]`, logged at error), `warn` keeps it raw (logged at warn), `off` passes it through untouched.

`validate()` gains a logger parameter so its `warn`-mode diagnostic — and the new per-device diagnostics — route through `config.logger` (R6, R3).

### Key Concepts

**Envelope schema.** A page schema that validates `pageDetails` exactly as today but treats `devices` as an array of opaque elements (each device is validated separately, not by this schema). Conceptually:

```ts
// Structure only — devices are validated per-item, not here.
const DevicesEnvelopeSchema = z.object({
  pageDetails: PaginationDataSchema.optional(),
  devices: z.array(z.unknown()).optional(),
});
```

`DevicesPageSchema` and `DeviceSchema` remain exported and unchanged (R4); the envelope schema is an internal detail of the pagination path.

**Generic `getAllPages` plumbing.** Today `getAllPages<T, P>` takes one page schema and an `extractor: (page: P) => T[]` that receives an *already-parsed* page and returns typed items. The per-item model changes this: the method takes an **envelope schema** (validating `P` with its items opaque) plus a **per-item schema** (`DeviceSchema`, applied to each element separately), and the extractor now pulls the *raw* items — `extractor: (page) => unknown[]` — from the envelope-validated page. So the new signature is `getAllPages<T, P>(envelopeSchema, itemSchema, extractor: (page: P) => unknown[], ...)`. For each page it validates the envelope per Decision 2, then calls the per-item helper on the extracted `unknown[]`, accumulating both the surviving `valid` items and the `warnings` across every page; when the walk completes it returns `{ ok: true, value: <all valid items>, warnings: <all accumulated warnings> }`. `pageDetails.nextPageUrl`, which drives the walk, is read from the envelope-parse result in `strict`/`warn` and directly off the raw page in `off`; it is not carried by the item extractor. If a later page's envelope hard-fails mid-walk, the call returns `{ ok: false, error: { type: "validation-error" } }` and discards all `valid` items and `warnings` accumulated from earlier pages — an unparseable page aborts the walk exactly as today, because pagination cannot continue past a page whose `nextPageUrl` cannot be read. The extractor's return type therefore changes from `T[]` to `unknown[]` — this is not preserved behavior.

**Per-item validation helper.** A function that applies `DeviceSchema` to each raw device and partitions the results by the mode, returning both the surviving devices and the rejections as `ProblemError`s:

```ts
// Illustrative shape — the Planner settles the exact signature.
function validateItems<T>(
  schema: ZodType<T>,
  items: unknown[],
  mode: ValidationMode,
  logger: LoggerLike,
): { valid: T[]; warnings: ProblemError[] };
```

- `off`: every item passes through as `T`; no validation, no logging.
- `warn`: every item is returned **raw and unparsed** — including items that would validate; the helper runs `DeviceSchema` only to *detect* divergence for logging, never to reshape the returned value. This is deliberate: `warn` is the documented drift workaround, and `z.object` parsing strips unknown keys, so returning parsed valid devices would silently drop fields that today survive. Keeping every item raw preserves the current passthrough contract exactly (R8). Each divergence is logged at `logger.warn`; nothing is dropped.
- `strict`: only validating items are returned; each divergent item is logged at `logger.error` and appended to `warnings` (R1, R2, R3).

Each rejection `ProblemError` uses `type: "validation-error"` and carries, in `detail`, the offending device's identity (`id`/`uid` where those fields are extractable from the raw object) and the Zod issue path, with the `ZodError` in `raw`.

**Logger-aware `validate()`.** `validate(schema, data, mode, logger?)` — the single-value seam used by `getDeviceByUid`. The `logger` is an **optional trailing parameter that defaults to `defaultLogger`**, so existing three-argument calls (e.g. `validate(DeviceSchema, device, "strict")` in `deviceSchema.test.ts`) keep compiling unchanged; the `warn`-mode routing guarantee (R6) therefore depends on the live caller — the client — passing `config.logger ?? defaultLogger` at the call site, which it does. In `warn` it logs through `logger.warn` instead of `console.warn`; in `strict` it still throws (its callers decide whether a throw is fatal). The per-item helper handles the array case; `validate()` handles the single-value case. Both share the same logger.

### Design Decisions

#### Decision 1: Validate per device, not per page

**Decision:** `getAllPages` validates the page envelope structurally, then validates each device in `devices[]` individually via the per-item helper. A device that fails `DeviceSchema` is excluded from the returned array and recorded in `warnings[]`; the pagination walk continues and the call returns `{ ok: true }` (R1, R2).

**Rationale:** The reported outage is caused precisely by page-granular validation — one device's `ZodError` is indistinguishable from a whole-page failure. Per-device validation is the smallest change that makes rejection scoped to the offending device while leaving conforming devices retrievable. The `Result.warnings[]` channel already exists to carry the rejections, so no `Result` type change is needed.

**Alternatives considered:**
- **Relax `DeviceSchema` so the divergent devices validate.** Rejected: it changes the public `Device` type (forcing consumer null-guards, R4), and it hides drift rather than surfacing it — a newly-added Datto field would silently pass and the schema would rot. Keeping the schema strict makes every divergence a visible, actionable signal.
- **Catch to sentinel values for the enums** (`deviceClass → "unknown"`, etc.). Rejected: it silently rewrites real data to a fallback, and only two of the three enums have an honest sentinel. "Strict" that quietly substitutes values is not strict.
- **Keep `strict` fail-hard and rely only on schema relaxation.** Rejected: relaxation was itself rejected, and even with it a genuinely novel device (new enum value, new required field) would still fail the whole account. Per-device resilience is the durable safety net.

#### Decision 2: Separate envelope errors from device errors

**Decision:** In `strict` and `warn` modes the page envelope (`pageDetails`, and that `devices` is an array) is validated as a unit via a **direct `safeParse` on the envelope schema** — deliberately *not* the mode-branching `validate()` seam, whose `warn` branch logs-and-passes-through and would therefore let a malformed page slip past. A structural failure fails the call with `{ ok: false, error: { type: "validation-error" } }` identically in both `strict` and `warn` (R5); the envelope check is a hard-fail independent of the per-device mode behavior. Only failures *within* individual `devices[]` elements are routed through the mode-sensitive per-item helper and treated as per-device drift. Envelope validation is **mode-gated**: in `off` it does **not** run — `off` means the caller opted out of all validation, so `getAllPages` reads `pageDetails?.nextPageUrl` best-effort off the raw page and returns `devices` untouched, exactly as today. R5's hard-fail guarantee is therefore scoped to `strict`/`warn`, matching the modes that validate at all.

**Rationale:** A malformed envelope is a protocol-level problem — the response is not a devices page, or pagination cannot proceed because `nextPageUrl` is unreadable. That is categorically different from a well-formed page containing one odd device, and salvaging "valid devices" from a response we cannot even parse as a page is meaningless. Failing hard on envelope errors preserves a clear, honest failure signal for genuine protocol breakage while device drift degrades gracefully. Gating this to `strict`/`warn` keeps `off`'s "no validation, never fails on shape" contract intact (R8): a caller who chose `off` accepted raw passthrough and should not gain a new hard-fail path.

**Alternatives considered:**
- **Treat every validation failure, envelope included, as a droppable warning.** Rejected: it would mask real protocol breakage (e.g. an auth-error body or an HTML error page shaped nothing like a devices page) as an empty-but-`ok` result, hiding outages instead of reporting them.

#### Decision 3: Thread the configured logger into validation

**Decision:** `validate()` takes a `LoggerLike` parameter, and the per-item helper takes one too. The client passes `config.logger ?? defaultLogger` — the same logger already given to `HttpClient`. `warn`-mode diagnostics go to `logger.warn`; strict per-device rejections go to `logger.error` (R3, R6).

**Rationale:** `warn` mode is the documented workaround for exactly this bug, yet its output is invisible to any consumer that configured a logger, because `validate()` hardcodes `console.warn`. Routing through `config.logger` makes drift observable in the consumer's own pipeline. Logging strict rejections at error level reflects the decision that drift is a defect requiring maintainer action, not a routine warning to be tuned out.

**Alternatives considered:**
- **Log strict rejections at `warn` level.** Rejected: the consumer's stance is that a validation failure signals a defect (schema drift) that must be addressed; error level ensures it is not filtered out alongside benign warnings.
- **Return the diagnostics only in `warnings[]` and log nothing.** Rejected: `warnings[]` requires the caller to inspect it; a log line reaches existing monitoring without code changes. Both channels serve distinct audiences, so the design uses both.

#### Decision 4: `getDeviceByUid` stays fail-hard, gains logging

**Decision:** `getDeviceByUid()` in strict mode continues to return `{ ok: false, error: { type: "validation-error" } }` when its single device diverges, and additionally logs the failure at error level through `config.logger` (R7). It adopts the logger-aware `validate()` but no partial-result behavior. The strict-path `logger.error` is emitted by `getDeviceByUid`'s own `catch` block, **not** by `validate()`: `validate()` deliberately does not log in `strict` (it throws, and the caller decides whether the throw is fatal and how to report it). This avoids double-logging and keeps the single-value seam's strict contract a pure throw. The per-item helper, by contrast, owns its own `logger.error` calls because it does not throw — it partitions and continues.

**Rationale:** Per-device resilience exists to salvage the *other* devices in a batch. A single-device fetch has no other devices to salvage — returning a partial or fabricated device would violate the type contract. Fail-hard is the only correct outcome; the only improvement available is routing its diagnostic through the configured logger for consistency with the batch path.

**Alternatives considered:**
- **Return the raw divergent device anyway.** Rejected: it would return a value that does not satisfy the `Device` type, defeating validation for the one caller that most expects a typed result.

## Migration Strategy

The change is internal to `getAllPages`, `validate`, and one new per-item helper. Public method signatures (`getAccountDevices`, `getDeviceByUid`, `updateDeviceUdfs`), the `Result`/`ProblemError` types, and the exported schemas and `Device` type are untouched.

Rollout is a single package version bump. Consumers on `strict` mode gain the resilient behavior automatically; consumers on `warn`/`off` see identical returned data, with `warn` diagnostics now flowing to their configured logger instead of `console`.

### Breaking Changes

None to the public type surface. Two **behavioral** changes worth calling out in release notes:

1. In `strict` mode, `getAccountDevices()` that previously returned `{ ok: false }` on a drifted account now returns `{ ok: true }` with the valid devices and a populated `warnings[]`. A consumer that branches on `!result.ok` to detect drift must instead inspect `result.warnings`. This is the intended fix, not a regression, but it changes the shape of the outcome for drifted accounts.
2. In `warn` mode, a *structurally malformed* page envelope (e.g. `devices` is not an array) now returns `{ ok: false, error: { type: "validation-error" } }`, where it previously logged and returned `{ ok: true, value: [] }`. This is the intended Decision 2 behavior — a malformed envelope is a protocol error in every mode that validates — and it affects only the envelope, not per-device data, which continues to pass through raw. `off` is unaffected (it runs no envelope check).
3. In `warn` mode, drift diagnostics also change *granularity*: the old page-level `validate()` emitted one `console.warn` per page carrying a single page-wide `ZodError`, whereas the per-item helper emits **one `logger.warn` per divergent device**. So `warn` output changes both sink (now `config.logger`, item 1 above notwithstanding) and shape/volume (N per-device lines instead of one per-page line). The returned data is unchanged; only the diagnostic stream is finer-grained.

### Data Migration

None. No persisted data, no stored schema, no cache format changes.

## Success Criteria

- In `strict` mode, `getAccountDevices()` against a page containing one valid and one divergent device returns `{ ok: true }` with exactly the valid device in `value` and one entry in `warnings[]` (R1, R2).
- The `warnings[]` entry identifies the divergent device (id/uid) and the failing field path (R2).
- The divergent device produces one `logger.error` call on the configured logger (R3).
- In `strict`/`warn`, a malformed page envelope (e.g. `devices` is not an array) returns `{ ok: false, error: { type: "validation-error" } }`; in `off` the same response passes through raw without failing (R5, R8).
- In `strict`, a walk whose first pages yield valid devices but whose later page has a malformed envelope returns `{ ok: false, error: { type: "validation-error" } }` with no partial `value` — the earlier pages' valid devices and warnings are discarded (R5).
- In `warn` mode, a divergent device produces a `logger.warn` call on the configured logger — not on `console` — and the device still appears in the returned data (R6, R8).
- `getDeviceByUid()` on a divergent device returns `{ ok: false }` and emits one `logger.error` (R7).
- `Device`, `DeviceSchema`, and every other export retain their current type (R4) — verified by the existing `deviceSchema.test.ts` fixture still validating unchanged.

### Verification

```
npm test          # existing suites plus new per-item resilience and logger-seam cases
npm run build     # tsc: confirms no change to the public type surface compiles differently
```

New tests cover: mixed valid/invalid page in strict (partial success + warning + error log), malformed envelope (hard fail), a multi-page walk whose later page's envelope is malformed (hard fail discarding earlier valid devices), warn-mode logger routing, and `getDeviceByUid` fail-hard-plus-log.

### What Stays the Same

- The public `Device` type, `DeviceSchema`, `DevicesPageSchema`, and all `src/index.ts` exports.
- `Result` and `ProblemError` type definitions.
- Pagination behavior (`pageDetails.nextPageUrl` walking). The extractor *pattern* remains — one function pulls items from a page — but its return type changes from `T[]` to `unknown[]` (see "Generic `getAllPages` plumbing"); the items are now validated per-element rather than arriving pre-parsed.
- `warn` and `off` returned-data contracts — every device still flows through.
- Authentication, rate limiting, retry, and HTTP behavior.

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| A consumer relies on `strict` failing the whole call to detect any drift, and now silently gets partial results. | Medium | Medium | Call out the behavioral change in release notes (see Breaking Changes); `warnings[]` and the error-level log give a louder, more actionable drift signal than a blanket failure did. |
| A Datto-wide schema change drifts every device, flooding the logger with per-device error lines and inflating the returned `warnings[]`. | Low | Low | One error line — and one `ProblemError` — per divergent device is proportionate and the intended signal; a flood is the correct alarm that the schema needs updating. `warnings[]` is unbounded by design, growing one full-`ZodError`-bearing entry per divergent device: it mirrors the log signal rather than capping or summarizing it, and consumers control log routing via `config.logger`. |
| Splitting envelope from per-item validation diverges from `DeviceSchema` if `DevicesPageSchema` later changes. | Low | Medium | The envelope schema reuses `PaginationDataSchema` and references `DeviceSchema` for per-item validation, so there is one source of truth per concern; a test asserts the envelope accepts the existing page fixtures. |
| Device identity (`id`/`uid`) is itself missing on a divergent device, so the warning cannot name it. | Low | Low | Extract id/uid best-effort from the raw object; when absent, fall back to the array index in `detail`. The `ZodError` in `raw` always carries the full path regardless. |

## Future Considerations

### Enabled by This Design

- **Schema-drift observability.** Error-level, per-device logs routed through the consumer's logger make it possible to detect and act on Datto RMM schema changes before they become outages — turning silent breakage into a monitored signal.
- **Reuse for future list endpoints.** The per-item validation helper and envelope/item split generalize to any future paginated collection endpoint, which can adopt resilient validation without re-deriving the pattern.

### Deferred Decisions

- **Relaxing `DeviceSchema` to match observed non-workstation devices.** Deferred out of scope. The deliberate stance is that the schema is the source of truth and divergence is a maintainer signal. Should the error logs show that real, valid Datto devices legitimately and routinely omit `patchManagement`/`antivirus`/`udf`, updating the schema — and the public `Device` type — becomes a considered follow-up driven by evidence from this design's logs, not a pre-emptive loosening.
- **A dedicated `errors[]`/rejected-devices channel distinct from `warnings[]`.** Deferred. `warnings[]` already exists and carries the rejections adequately; introducing a parallel channel is unwarranted until a consumer demonstrates a need to distinguish rejected-device warnings from other warning kinds.

### Open Questions

None — every question and assumption this design depends on is resolved.
