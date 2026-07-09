# Implementation Notes — Phase 7

- **Plan:** full-api-surface
- **Phase:** 7
- **Date:** 2026-07-09
- **Agent:** Implementor

---

## 1. Phase Scope Confirmation

**In-Scope (Phase 7 only):**
- `src/client/resources/account-resource.ts`, `site-resource.ts`, `device-resource.ts`,
  `alert-resource.ts`, `job-resource.ts` — the five `*Resource` classes the plan names.
- `src/client/resources/narrow.ts`, `void-response.ts`, `variable-schema.ts` — small shared
  helpers/schemas the five resources above need (documented in §6).
- `src/client/datto-rmm-client.ts` — the `DattoRmmClient` scaffold: config validation, the
  masked-logger boundary, rate limiter, shared axios instance, `AuthManager` wiring, and mounting
  the five namespaces this phase builds.
- Unit tests for every resource (nock) plus a scaffold test, all under
  `tests/unit/client/resources/**` and `tests/unit/client/datto-rmm-client.test.ts`.

**Explicitly Out-of-Scope:**
- The remaining five namespaces (`audit`, `filters`, `users`, `activityLogs`, `system`),
  `createDattoRmmClient(config)`, and the new `src/index.ts` barrel — all Phase 8.
- `src/index.ts` — untouched; the old barrel stays active per the plan's coexistence rule (plan
  Phase 7 Step 6: "Do not touch `src/index.ts` yet").
- The old runtime surface (`src/client.ts`, `src/config.ts`, `src/auth.ts`, `src/httpClient.ts`,
  `src/rateLimiter.ts`, `src/tokenStore.ts`, `src/validation.ts`, `src/schemas.ts`,
  `src/logger.ts`, `src/result.ts`, `src/internal/`) — untouched, still compiling.
- Phase 5's `src/rate-limit/rate-limits.ts` (`WRITE_LIMITS` table) — untouched. One real write
  operation (`POST /api/v2/site/{siteUid}`, site update) has no corresponding `WriteOpKey` and is
  therefore not implemented this phase; see §5/§11.
- Two exceptions, both necessary and minimal, documented fully in §5:
  - `src/client/datto-client-config.ts` — one doc-comment correction (stale "wired in Phase 8"
    forward reference; `DattoRmmClient` is wired in this phase).
  - `src/validation/schema-leniency.ts` (a Phase 4 file) — one small, targeted bug fix required
    for `AlertResource` to actually deliver R8's `alertContext` guarantee at runtime; not a
    refactor, not a Phase 4 re-litigation.

---

## 2. Phase Intent (Interpreted)

Implement the first five `*Resource` classes over `BaseResource` (Phase 6) — `account`, `sites`,
`devices`, `alerts`, `jobs` — each exposing its operations as thin methods that pick the right
generated/reconciled schema and the correct rate-limit `opKey`, and stand up the `DattoRmmClient`
scaffold that constructs and wires every lower layer (config validation, masked logger, rate
limiter, shared axios instance, throwing `AuthManager`) and mounts these five namespaces. Prove
the three retired 0.1.x methods' exact pinned replacements (design Decision 5):
`client.devices.get(uid)`, `client.account.devices()`, `client.devices.setUdf(uid, udf)`
(realigned to the corrected `POST /api/v2/device/{uid}/udf`).

---

## 3. Files Touched

| File | Change Type | Rationale |
|------|------------|-----------|
| `src/client/resources/account-resource.ts` | Created | `AccountResource`: `get`, `devices`, `variables`, `createVariable`/`updateVariable`/`deleteVariable`, `components`, `dnetSiteMappings` |
| `src/client/resources/site-resource.ts` | Created | `SiteResource`: `list`, `get`, `create`, `devices`, `devicesWithNetworkInterface`, `variables`, `createVariable`/`updateVariable`/`deleteVariable`, `settings`, `deviceFilters`, `updateProxy`/`deleteProxy` |
| `src/client/resources/device-resource.ts` | Created | `DeviceResource`: `get`, `getById`, `getByMacAddress`, `move`, `createJob`, `setUdf`, `setWarranty` |
| `src/client/resources/alert-resource.ts` | Created | `AlertResource`: `get`, `resolve`, `mute`, `unmute`, `open`/`resolved`/`openForSite`/`resolvedForSite`/`openForDevice`/`resolvedForDevice` |
| `src/client/resources/job-resource.ts` | Created | `JobResource`: `get`, `getResults`, `getStdOut`, `getStdErr`, `getComponents` |
| `src/client/resources/narrow.ts` | Created | Shared `narrow<T>(value: unknown): T` — the `Lenient<T>`→`T` re-assertion `BaseResource`'s own doc names as each resource method's responsibility, factored once instead of redefined per file |
| `src/client/resources/void-response.ts` | Created | Shared `voidResponseSchema` — see §5 Deviation 1 |
| `src/client/resources/variable-schema.ts` | Created | Shared `variableSchema` (Datto has no standalone single-`Variable` `GET` endpoint to reuse a generated schema from; `AccountResource`/`SiteResource` both walk a `{pageDetails, variables}` envelope) |
| `src/client/datto-rmm-client.ts` | Created | `DattoRmmClient`: config `.safeParse` → `DattoValidationError`, masked logger, `MultiWindowRateLimiter`, `createHttpClient`, `AuthManager.attachTo`, mounts `account`/`sites`/`devices`/`alerts`/`jobs` |
| `src/client/datto-client-config.ts` | Modified (doc only) | Corrected a stale "wired in Phase 8" forward reference (`DattoRmmClient` is wired in this phase, not Phase 8) — no behavior change |
| `src/validation/schema-leniency.ts` | Modified (bug fix) | `cleanAndDiagnoseResponse`'s `'object'` case now preserves an extra key when the *original* schema declares a meaningful `.catchall(...)` (e.g. `alertContextSchema`), instead of always stripping it — see §5 Deviation 2 |
| `tests/unit/client/resources/account-resource.test.ts` | Created | 9 tests (nock) |
| `tests/unit/client/resources/site-resource.test.ts` | Created | 13 tests (nock) |
| `tests/unit/client/resources/device-resource.test.ts` | Created | 10 tests (nock), incl. an R20 end-to-end masking assertion |
| `tests/unit/client/resources/alert-resource.test.ts` | Created | 10 tests (nock) |
| `tests/unit/client/resources/job-resource.test.ts` | Created | 5 tests (nock) |
| `tests/unit/client/datto-rmm-client.test.ts` | Created | 4 tests: namespace mounting, invalid-config throw, retired-field rejection, and one full-stack integration test (auth grant → `Authorization: Bearer` → rate-limited v2 call) |

---

## 4. Implementation Summary

**Resource classes.** Each of the five `*Resource` classes extends `BaseResource` (Phase 6) and
calls only its `http*`/`paginate` primitives — never `this.axios` directly — so every request
carries a `RateDescriptor` and runs through validation. Every method:
- Selects the **reconciled** schema (`deviceSchema`/`alertSchema`, `src/schema-overrides`) for a
  `Device`/`Alert`-shaped response, reused verbatim across every namespace that returns one
  (`account.devices()`, `sites.devices()`, `devices.get()`, `devices.getByMacAddress()` all share
  `deviceSchema`; every alert read shares `alertSchema`) — never a tag file's own duplicate.
- Selects the **generated** schema directly for an entity `schema-overrides/` does not touch
  (`Account`, `Site`, `Job`, …) — these already carry the Phase 2 codemod's open-enum widening at
  the type level, so no override is needed.
- Declares a clean, honest return type (`Device`, `Promise<Alert[]>`, …) rather than propagating
  `BaseResource`'s `Lenient<T>`, via the shared `narrow<T>` re-assertion (§3) — the pattern
  `BaseResource.validateResponse`'s own doc names as each resource method's responsibility.
- Tags every write with a `WriteOpKey` from Phase 5's closed union — a mistyped or unlisted key is
  a compile error, not a silent mis-throttle.

**Namespace grouping is concept-first, not a literal port of Datto's own tag structure** — the
design's public surface names this explicitly (`client.alerts.openForSite(siteUid)` rehomes a
`-v2-site`-tagged read into `AlertResource`). Applied consistently:
- **All ten alert-reading operations** (`get`/`resolve`/`mute`/`unmute`, genuinely `-v2-alert`
  tagged, plus the six paginated `open`/`resolved` reads scattered across `-v2-account`/`-v2-site`/
  `-v2-device`) live under `AlertResource`, never under `account`/`sites`/`devices`.
- **The site collection** (`GET /api/v2/account/sites`, `-v2-account` tagged) lives under
  `SiteResource.list()`, not `AccountResource` — the plan's own Phase 7 Step 2 phrasing ("site
  list/get") pins it there; there is no historical-parity constraint (unlike `devices()`, which
  design Decision 5 pins to `client.account.devices()` by exact name, preserving the retired
  `getAccountDevices`' shape).
- **`getUsers`** (`GET /api/v2/account/devices`'s sibling `GET /api/v2/account/users`) is
  deliberately **not** implemented in `AccountResource` this phase — deferred to Phase 8's
  `UserResource` ("user reads", the design's plural `users` namespace), whose natural conceptual
  home is the entity it returns, not the tag Datto's spec happens to group it under. Left out
  rather than guessed at, so Phase 8 cannot collide with a duplicate mapping for the same
  operation.
- **Site proxy writes** (`POST`/`DELETE /api/v2/site/{siteUid}/settings/proxy`) live on
  `SiteResource`, not `DeviceResource`, despite the plan's Phase 7 Step 3 text grouping "warranty/
  proxy writes" under `DeviceResource` — the real spec has no device-scoped proxy endpoint at all
  (confirmed by direct enumeration of `spec/openapi.json`); this follows the actual API topology
  over the plan's shorthand (spirit over literalism), reusing the `device-proxy-set` `WriteOpKey`
  Phase 5 already named for them.

**`DattoRmmClient` scaffold.** The constructor `.safeParse`s the config, throwing
`DattoValidationError(err, 'request')` on failure before anything else is built (matches
`FuzeClient`'s precedent, per `datto-client-config.ts`'s own doc). It then builds, in order: the
masked logger (`withUdfMasking(config.logger ?? consoleLogger)`), the `MultiWindowRateLimiter`
(config `rateLimit` overrides), `AuthManager` (config `apiKey`/`apiSecret`/`tokenRefreshPct`), the
shared axios instance via `createHttpClient` (with `onUnauthorized: () =>
authManager.invalidate()`), and finally `authManager.attachTo(axiosInstance)` — exactly the
construction order Phase 5's `http-client.ts`/`auth-manager.ts` docs specify. All five resources
are constructed against that one shared axios instance and that one masked logger.

---

## 5. Deviations From Plan (If Any)

**Deviation 1 — `voidResponseSchema` (`z.unknown()`) instead of the plan's illustrative
`z.void()` for a bodiless-response write.** The plan's own Phase 7 "Opinionated Implementation
Notes" snippet uses `z.void()` as the response schema for `setUdf`. Building and testing the ten
real bodiless-response writes (`resolve`/`mute`/`unmute`, `move`, `setUdf`, `setWarranty`,
`createVariable`/`updateVariable` ×2) against a real (nock-mocked) HTTP transport surfaced that
this fails **every one of them**, not just in a test: `z.void()` only accepts an actual
`undefined`, but axios's real behavior for a genuinely empty response body is the empty string
`""` (confirmed directly — `nock(...).reply(200)` with no body resolves `response.data` to `""`,
not `undefined`). Every such write would have thrown `DattoValidationError('response')` against a
real Datto empty response in production. Replaced with a documented `voidResponseSchema =
z.unknown()` (`src/client/resources/void-response.ts`) that accepts whatever the server actually
sends back without failing the call; the resource method's own declared `Promise<void>` — not the
schema — is what tells a caller there is nothing useful in the response, and no such method
returns the resolved value. This is a plan-sketch correction, not a design deviation: the plan's
own "code samples in it are guidance, not mandates" rule applies, and R6/R7's actual intent
(validate what's real, don't silently fail a legitimate call) is better served by this schema.

**Deviation 2 — bug fix in `src/validation/schema-leniency.ts`'s `cleanAndDiagnoseResponse`
(Phase 4 file), required for R8's `alertContext` guarantee to hold end-to-end.**
`alertContextSchema` (`src/schema-overrides/alert-overrides.ts`, Phase 6) is documented as
existing specifically so "an alert's real context fields … survive validation instead of being
the one property this open object happens to declare" — i.e. an unmodeled `@class`-specific field
(e.g. `comp_script_ctx`'s `exitCode`) should survive all the way through a resource method's
returned value, not just avoid rejecting the whole record. Writing `AlertResource.get()`'s test
against a real `alertContext` payload proved this false: `cleanAndDiagnoseResponse`'s `'object'`
case unconditionally stripped any key not literally named in `schema.shape`, **regardless of
whether the schema declared its own `.catchall(...)`** — so `alertContextSchema`'s catchall
correctly widened the *parse* (nothing was rejected) but the subsequent *clean* pass silently
dropped the extra field anyway. Phase 6's own `alert-overrides.test.ts` never caught this because
it exercises `alertContextSchema.safeParse(...)` directly (which does respect the schema's own
catchall — that's just standard zod behavior), never the full `parseLenient` pipeline
`BaseResource.validateResponse` actually uses. Fixed by adding `objectCatchall(schema)` (mirroring
the existing `objectShape` accessor) and, in `cleanAndDiagnoseResponse`'s `'object'` case, keeping
(and recursively cleaning) an extra key against the schema's own catchall value schema when one is
declared, instead of treating it as unknown. Verified `z.strictObject()`'s catchall is a `ZodNever`
(not `undefined`) at the zod v4 runtime level, so `objectCatchall` explicitly excludes a `never`
-typed catchall — a `strictObject` (every generated write body) must not start silently admitting
extra keys through this path (moot for request validation today, since `validateRequest` never
calls `parseLenient`, but the helper is typed to be correct standalone, not correct only by
accident). This is a minimal, targeted fix (one new accessor, one new `else if` branch) with a
full explanatory comment at both the accessor and the call site; the existing 88-test
`schema-leniency.test.ts` suite (including its `strictObject` cases) stayed green throughout, and
the new `alert-resource.test.ts` end-to-end assertion (an `alertContext` with an extra field
surviving through `AlertResource.get()`) is what actually proves the fix. Labeled a "Phase 7
necessity" per the plan's Guardrails: it repairs a defect this phase's own new, correct tests
exposed, required for `AlertResource` — this phase's own deliverable — to satisfy R8, not an
unrelated refactor of Phase 4.

No other deviations. Every other design/plan interpretation (namespace grouping, opKey reuse,
skipped operations) is documented in-place in the relevant class's own JSDoc (§4) rather than
repeated here.

---

## 6. Ambiguities & Decisions

- **Shared item schemas for entities `schema-overrides/` doesn't touch.** `Variable` has no
  standalone single-entity `GET` endpoint (unlike `Device`/`Site`/`Alert`), so Orval inlines its
  shape independently inside both `getAccountVariablesResponse` and `getSiteVariablesResponse` —
  two structurally-identical but differently-generated schemas. Rather than validate
  `AccountResource.variables()`/`SiteResource.variables()` against two independent duplicates (the
  same "tag file's own duplicate" hazard `device-overrides.ts` documents for `Device`), hand-wrote
  one `variableSchema` (`src/client/resources/variable-schema.ts`) both resources import. Every
  *other* item schema this phase hand-writes (`Component`, `DnetSiteMappingsDto`,
  `DeviceNetworkInterface`, `Filter`, `JobComponent`) is scoped locally to the one resource file
  that needs it, since nothing else in this phase shares them — this is not a general precedent for
  a growing shared-schemas module, just the one genuinely-shared case.
- **`getUsers` placement (AccountResource vs. Phase 8's UserResource).** No explicit design text
  settles this the way `openForSite`/`account.devices()` do. Resolved in favor of deferring to
  Phase 8 (§4) — the lower-risk choice: leaving it out is a gap Phase 8's own coverage-map test
  (plan Phase 8 Step 8) will mechanically catch and force a decision on; implementing it here risks
  Phase 8 duplicating the same operation under `UserResource`, a harder-to-detect conflict.
- **Site `update()` (`POST /api/v2/site/{siteUid}`) is not implemented.** Phase 5's `WRITE_LIMITS`
  table has no `WriteOpKey` for it — a gap `write-bodies.ts` (Phase 6) already flagged as needing a
  new key added to that untouched Phase 5 file before the method could exist. Editing
  `rate-limits.ts` is out of this phase's declared step scope (unlike the `schema-leniency.ts` fix
  in §5, this is not required for any of this phase's own deliverables to function — `SiteResource`
  is fully usable and tested without `update()`). Documented in `SiteResource`'s class doc and
  flagged again here for a maintainer/reviewer to add `'site-update'` to `WRITE_LIMITS`.
- **`account-variable-set`/`site-variable-set`/`device-proxy-set` reused for their `DELETE`
  counterparts.** Phase 6's remaining-risks section explicitly left this decision to Phase 7/8,
  citing the design's own "variable mutations"/"proxy... mutations" grouping language. Resolved:
  every delete reuses its create/update sibling's `WriteOpKey`, documented at each call site.
- **`mute`/`unmute` are implemented despite being `@deprecated` in the spec.** R1 requires the
  entire documented v2 surface, deprecated or not; the plan's own Phase 7 Step 4 text ("resolve
  (uid) (alert-resolve), muting") names both explicitly.

---

## 7. Tests

- **`account-resource.test.ts`** (9): every method's path/verb, response leniency (unknown-key
  strip via `get()`), `opKey` tagging on every write, and malformed/empty-body rejection for
  `createVariable`/`updateVariable`.
- **`site-resource.test.ts`** (13): every method's path/verb (including `list()`'s
  `GET /account/sites`, confirming the namespace-placement decision), `opKey` tagging on every
  write (including the reused delete opKeys), malformed-body rejection for `create()`, and the
  all-omitted-body rejection for `updateProxy()`.
- **`device-resource.test.ts`** (10): every method's path/verb; `getByMacAddress()`'s per-item
  drop (R7) via `httpGetArray`; `createJob()`'s required-field rejection; `setUdf()`'s empty-body
  rejection; `setWarranty()`'s null-`warrantyDate`/all-omitted-body cases; and one **R20
  end-to-end** test asserting a raw UDF value passed to `setUdf` never reaches the underlying log
  sink through the full `withUdfMasking` → `BaseResource` → leniency-diagnostic path.
- **`alert-resource.test.ts`** (10): every method's path/verb, including all six
  `open`/`resolved` × account/site/device combinations, and an `alertContext` payload carrying an
  unmodeled extra field (`exitCode`) that survives through `get()` — the assertion that proves
  §5 Deviation 2's fix.
- **`job-resource.test.ts`** (5): every method's path/verb, including `get()`'s truly-novel
  `status` value surviving (R5 enum widening) and both bare-array `httpGetArray` endpoints.
- **`datto-rmm-client.test.ts`** (4): the five namespaces are mounted as the correct classes;
  an invalid config throws `DattoValidationError('request')` before anything is constructed; a
  retired 0.1.x field (`validationMode`) is rejected via the same path; and one full-stack
  integration test — a mounted resource's call fetches an OAuth token, attaches
  `Authorization: Bearer`, and completes through the real (nock-mocked) transport.

---

## 8. Security & Best-Practices Review

- **No new dependencies.** Everything is built on Phase 1–6's already-adopted stack (axios, zod,
  nock/vitest for tests).
- **R20 (UDF masking) verified end-to-end**, not just at the decorator's own unit level (Phase 3)
  — `device-resource.test.ts`'s masking test drives a real `setUdf` call through
  `BaseResource`/`parseLenient`'s leniency diagnostics and asserts the sink never sees the raw
  value.
- **No credential/secret handling introduced.** `DattoRmmClient`'s constructor passes
  `apiKey`/`apiSecret` straight to `AuthManager` (Phase 5, unchanged) and never logs them; the
  masked logger is constructed once and threaded through every layer, matching the single-boundary
  guarantee.
- **No `any` introduced.** `narrow<T>`/`voidResponseSchema`'s `unknown`-typed casts are the
  documented, intentional pattern `BaseResource`'s own doc already names (`coerceSchema`'s
  sibling), not an escape hatch; `npm run lint` reports the same 11 pre-existing warnings (all in
  the untouched old surface) and zero new ones.
- **The `schema-leniency.ts` fix (§5 Deviation 2) was verified not to weaken request-side
  validation**: `objectCatchall` explicitly treats a `z.strictObject()`'s `ZodNever` catchall as
  "no catchall" (confirmed against zod v4's actual runtime `_zod.def.catchall` shape), so no
  generated write-body schema could start silently admitting an extra key through this path even
  if it were ever routed through `parseLenient` (it currently is not — `validateRequest` uses
  plain `.safeParse`).

---

## 9. Self-Review Scoring

| Element | Before | After | Comments |
|---------|--------|-------|----------|
| Extensibility | 9.0 | 9.7 | Shared `narrow`/`voidResponseSchema`/`variableSchema` factored out once new resources exposed the actual need, rather than duplicated per file; every namespace-placement/opKey-reuse decision is documented at its own call site for a Phase 8 implementor to follow the same pattern. |
| Understandability | 9.2 | 9.6 | Every deviation from the plan's literal text (namespace grouping, proxy placement, `z.unknown()` vs `z.void()`) is justified in-place with a concrete citation to the plan/design text or a verified runtime fact, not just asserted. |
| Best Practices | 9.0 | 9.6 | Found and fixed a real, previously-undetected correctness bug (§5 Deviation 2) via genuine end-to-end testing rather than writing a test that happened to pass; every write is typed against the closed `WriteOpKey` union; zero new lint warnings. |
| Plan Adherence | 9.0 | 9.6 | All five named resource classes and the scaffold implemented; every knowing departure from the plan's literal phrasing (proxy placement, `z.void()`) is spirit-over-literalism per the plan's own interpretation rule, documented and defended, not silent. |
| Test Quality | 9.0 | 9.6 | 51 new tests covering path/verb correctness, `opKey` tagging, malformed-body rejection, R5/R7 leniency, and an R20 end-to-end assertion; the alert-context test is what actually caught Deviation 2 rather than being retrofitted after the fact. |

---

## 10. Iterative Improvements Made

- Discovered (via `account-resource.test.ts`'s `createVariable`/`updateVariable` tests) that
  `z.void()` cannot validate a real empty HTTP response; replaced with `voidResponseSchema`
  (`z.unknown()`) across all ten bodiless-response write call sites (§5 Deviation 1) and converted
  each affected method to `async`/`await` so the (now-discarded) resolved value is never returned.
- Discovered (via `alert-resource.test.ts`'s `get()` test) that `alertContextSchema`'s catchall was
  not actually preserving extra fields through the full `parseLenient` pipeline; fixed
  `cleanAndDiagnoseResponse` in `schema-leniency.ts` (§5 Deviation 2), then re-verified the fix
  does not affect `z.strictObject()` (request-body) schemas by checking zod v4's runtime
  `_zod.def.catchall` shape directly and adding the `never`-exclusion.
- Ran `npx prettier --write` over every new/changed file for formatting consistency, then re-ran
  the full `lint`/`typecheck`/`test`/`build` sequence to confirm no behavioral change (mirrors
  Phase 6's own closing step).
- Corrected `datto-client-config.ts`'s stale "wired in Phase 8" doc comment to "wired in Phase 7"
  now that `DattoRmmClient` actually exists.

---

## 11. Remaining Risks or Follow-Ups

- **Site `update()` (`POST /api/v2/site/{siteUid}`) has no `WriteOpKey`.** Flagged in §6; a
  maintainer/reviewer needs to add `'site-update'` to Phase 5's `WRITE_LIMITS` table before
  `SiteResource.update()` can be implemented. Not blocking this phase (no plan step requires it),
  but it is a real, uncovered spec operation until resolved — Phase 8's coverage-map test (plan
  Phase 8 Step 8) will surface it mechanically if it is still missing by then.
- **`getUsers` deferred to Phase 8.** Phase 8's `UserResource` implementor should confirm this
  operation lands there (`GET /api/v2/account/users`) rather than assuming `AccountResource`
  already covers it.
- **`filter-create`/`filter-delete` dead `WriteOpKey` table entries** (Phase 6's already-flagged
  risk) — unchanged by this phase; still Phase 8's `FilterResource` to concretely confirm.
- **The `schema-leniency.ts` fix's blast radius is deliberately narrow today** (only
  `alertContextSchema`/`pageDetailsSchema` declare a non-`strictObject` catchall among response
  schemas this client validates) but is now correct for any *future* hand-written override that
  adds its own `.catchall(...)` — Phase 8/9 schema-override work can rely on it without
  rediscovering the same gap.

---

## 12. Commands Run / To Run

- `npm run lint` — 0 errors, 11 pre-existing warnings (all in the untouched old surface:
  `src/auth.ts`, `src/client.ts`, `src/httpClient.ts`, `src/logger.ts`), unchanged from Phase 6's
  baseline.
- `npm run typecheck` (`typecheck:src` + `typecheck:test` + `typecheck:tools`) — clean.
- `npm test` — 374 tests passing across 31 files (51 new this phase; every pre-existing test from
  Phases 1–6 still green, confirming coexistence and that the `schema-leniency.ts` fix introduced
  no regression).
- `npm run build` — `tsup` succeeds, output unchanged (`src/index.ts` untouched this phase, per
  the coexistence rule).
- `npx prettier --write` — applied to every new/changed file, followed by a full re-run of
  lint/typecheck/test/build to confirm no behavioral change.
- Scratch (uncommitted) `node -e` checks against a live zod v4 instance to confirm (a) axios's real
  `response.data` for an empty body (`""`, not `undefined` — Deviation 1) and (b)
  `z.strictObject()`'s `_zod.def.catchall` shape (`ZodNever`, not `undefined` — Deviation 2's
  `never`-exclusion).

---

## 13. Final Assertion

I assert that:
- Only Phase 7 has been implemented — the five named resource classes and the `DattoRmmClient`
  scaffold mounting them, plus the minimal, fully-documented necessities in `datto-client-config.ts`
  (doc-only) and `schema-leniency.ts` (a targeted bug fix required for this phase's own
  `AlertResource` to satisfy R8) that this phase's own testing surfaced.
- No unnecessary scope expansion occurred: `src/index.ts`, the remaining five namespaces,
  `createDattoRmmClient`, and Phase 5's `rate-limits.ts` table are all untouched, left for Phase 8
  (or a maintainer, for the `site-update` gap) as documented in §6/§11.
- All quality scores are ≥ 9.5.
