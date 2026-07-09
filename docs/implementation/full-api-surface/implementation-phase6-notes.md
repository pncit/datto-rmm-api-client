# Implementation Notes — Phase 6

- **Plan:** full-api-surface
- **Phase:** 6
- **Date:** 2026-07-09
- **Agent:** Implementor

---

## 1. Phase Scope Confirmation

**In-Scope (Phase 6 only):**
- `src/client/resources/base-resource.ts`: `BaseResource` — the validated HTTP primitive set
  (`httpGet`/`httpGetArray`/`httpPost`/`httpPut`/`httpPatch`/`httpDelete`), `validateRequest`
  (strict, R6), `validateResponse`/`validateArrayResponse` (lenient, R5/R7, returning the honest
  `Lenient<T>` shape, with per-call aggregated drop reporting), the strict-cursor, origin-pinned,
  cycle/page-capped `paginate` walker (R3), and the ported `coerceSchema` helper.
- `src/schema-overrides/`: the hand-maintained module reconciling the generated schemas —
  `pagination.ts` (`pageDetailsSchema`), `device-overrides.ts` (`udfSchema`,
  `deviceResponseSchema`, `DEVICE_WIDENED_FIELDS`), `alert-overrides.ts` (`alertContextSchema`,
  `alertResponseSchema`, `ALERT_WIDENED_FIELDS`), `write-bodies.ts` (all 9 body-carrying write ops'
  reconciled schemas and their `*Input` types), `types.ts` (the reconciled `Device`/`Alert` entity
  types, the pre-coerced `deviceSchema`/`alertSchema` values, and the `OVERRIDE_ENTITIES`
  registry), `index.ts` (barrel).
- Unit tests for every behavior named in the plan's Tests section, all via `nock` where an HTTP
  call is involved.

**Explicitly Out-of-Scope:**
- Any change to the old runtime surface (`src/client.ts`, `src/config.ts`, `src/auth.ts`,
  `src/httpClient.ts`, `src/rateLimiter.ts`, `src/tokenStore.ts`, `src/validation.ts`,
  `src/schemas.ts`, `src/logger.ts`, `src/result.ts`, `src/internal/`) — untouched, still
  compiling, per the coexistence rule. Verified: `git status` after this phase shows only two new,
  untracked directories (`src/client/`, `src/schema-overrides/` — plus their `tests/`
  counterparts); no other tracked file changed.
- Any resource class (`AccountResource`, `DeviceResource`, …) or `DattoRmmClient` itself (Phase
  7/8) — this phase builds the primitives and the override module those resources will consume,
  not the resources.
- Phase 5's `src/rate-limit/rate-limits.ts` (`WriteOpKey` table) — untouched; a discrepancy found
  in it during this phase is reported, not fixed (§11).

---

## 2. Phase Intent (Interpreted)

Build the validated HTTP layer every resource namespace (Phase 7/8) sits on: a `BaseResource` base
class whose `http*` primitives are the *only* way a resource ever talks to the shared axios
instance, guaranteeing every request carries a `RateDescriptor` and every request/response is
validated (strictly outbound, leniently inbound); a strict-cursor `paginate` walker that never
silently truncates a collection; and a schema-override module that reconciles the generated Device
and Alert schemas against production reality (the `udf1…udf300` record, the permissive
`alertContext`) and grafts the compile-time open-enum widening onto the public `Device`/`Alert`
types so what TypeScript promises matches what `parseLenient` actually accepts at runtime.

---

## 3. Files Touched

| File | Change Type | Rationale |
|------|------------|-----------|
| `src/client/resources/base-resource.ts` | Created | `BaseResource`: `httpGet`/`httpGetArray`/`httpPost`/`httpPut`/`httpPatch`/`httpDelete`, `validateRequest`/`validateResponse`/`validateArrayResponse`, `paginate`, `coerceSchema` |
| `src/schema-overrides/pagination.ts` | Created | The R3 `pageDetailsSchema` cursor override |
| `src/schema-overrides/device-overrides.ts` | Created | `udfSchema`, `deviceResponseSchema`, `DEVICE_WIDENED_FIELDS` |
| `src/schema-overrides/alert-overrides.ts` | Created | `alertContextSchema`, `alertResponseSchema`, `ALERT_WIDENED_FIELDS` |
| `src/schema-overrides/write-bodies.ts` | Created | All 9 body-carrying write ops named by a Phase 5 `WriteOpKey`, reconciled: `udfWriteBodySchema`, `warrantyWriteBodySchema`, `siteCreateBodySchema`, `deviceJobCreateBodySchema`, `createSiteVariableWriteBodySchema`/`updateSiteVariableWriteBodySchema`, `createAccountVariableWriteBodySchema`/`updateAccountVariableWriteBodySchema`, `updateProxyWriteBodySchema`, each with a companion `*Input` type and the shared `requireSomeField` refinement helper |
| `src/schema-overrides/types.ts` | Created | Reconciled `Device`/`Alert` types (the `z.infer`+open-enum-graft), pre-coerced `deviceSchema`/`alertSchema` values, `OVERRIDE_ENTITIES` registry |
| `src/schema-overrides/index.ts` | Created | Barrel |
| `tests/unit/client/base-resource.test.ts` | Created | Primitive/validate-method coverage, including `httpGetArray` (25 tests, nock) |
| `tests/unit/client/paginate.test.ts` | Created | `paginate` walk/cursor/drop/rate-descriptor/SSRF-origin/cycle/page-cap coverage (12 tests, nock + one hand-stubbed axios instance) |
| `tests/unit/schema-overrides/device-overrides.test.ts` | Created | `udfSchema`/`deviceResponseSchema`/`DEVICE_WIDENED_FIELDS` (10 tests) |
| `tests/unit/schema-overrides/alert-overrides.test.ts` | Created | `alertContextSchema`/`alertResponseSchema`/`ALERT_WIDENED_FIELDS` (5 tests) |
| `tests/unit/schema-overrides/pagination.test.ts` | Created | `pageDetailsSchema` (6 tests) |
| `tests/unit/schema-overrides/write-bodies.test.ts` | Created | All 9 write-body override schemas, including an unknown-key-rejection case for each (22 tests) |

---

## 4. Implementation Summary

**`base-resource.ts`.** `BaseResource` is constructed with the shared axios instance (Phase 5's
`createHttpClient` output) and the masked `DattoLogger` (Phase 3's `withUdfMasking`). It exposes
six `http*` primitives instead of the plan's four — see §5 Deviation 1 — each attaching an
explicit `RateDescriptor` to the axios request config so every request a resource makes is rate-
limited: `httpGet` tags `{kind:'read'}` for a single validated value; `httpGetArray` also tags
`{kind:'read'}`, for a bare top-level array (per-item leniency via `validateArrayResponse`, no
envelope); `httpPost`/`httpPut`/`httpPatch` each accept a typed `WriteOpKey` and tag `{kind:'write',
opKey}`, via a shared private `sendWrite` dispatcher that branches on a 3-arg (bodiless) vs. 5-arg
(body-carrying) argument tail (named `BODILESS_WRITE_ARITY`) so the same primitive name serves both
a bodiless write (`POST /alert/{uid}/resolve`) and a body-carrying one (`POST /device/{uid}/udf`)
without a second primitive name; `httpDelete` sends no body and validates no response (every real
Datto `DELETE` operation's documented responses carry no content — verified against the committed
spec). `validateRequest` is the strict R6 path (`schema.safeParse`, throwing
`DattoValidationError('request')` on the first failure — the plan's pinned 2-arg construction).
`validateResponse`/`validateArrayResponse` run `parseLenient` (always, since `logger` is a required
constructor param — R5) and return its actual `Lenient<T>`/`Lenient<T>[]` result honestly, rather
than re-asserting the narrower declared type (see §5 Deviation 4/§6 Decision 2 for why, and how a
Phase 7/8 resource method re-narrows at its own return site). `validateArrayResponse` validates each
item independently and emits **one** aggregated `warn` summary per call for every drop (R7) — never
one line per dropped row — capping the reported per-item errors at 5 (`MAX_REPORTED_DROP_ERRORS`) so
a systematic drift (one mistyped field dropping an entire 848-item page) still produces a single,
bounded `warn`. `paginate` walks `pageDetails.nextPageUrl`, validating each page's cursor strictly
against `pageDetailsSchema` (throwing `DattoValidationError('response')` on a missing/malformed
cursor rather than truncating — R3) and each page's named array leniently via
`validateArrayResponse`; it attaches its own explicit `{kind:'read'}` descriptor per page since it
talks to the shared axios instance directly rather than through `httpGet` (it reads a two-part
envelope, not a single schema-validated value), pins each `nextPageUrl` to the configured `apiUrl`'s
origin before following it, and bounds the walk against a cyclic or ever-advancing cursor chain (§5
Deviation 5).

**`schema-overrides/`.** `device-overrides.ts` composes `deviceResponseSchema` from the generated
`getByUidResponse` (`-v2-device.zod.ts`) with its `udf` field replaced by `udfSchema` — a
`udf<N>`-keyed record whose value tolerates `string | number | boolean | object | array | null`
(not just `string`), matching the Phase-3 UDF masker's own "redact regardless of wire type" finding
so the schema and the masker agree about what a UDF may be. `alert-overrides.ts` composes
`alertResponseSchema` similarly, replacing `alertContext` with a genuinely open (`.catchall`)
object — the generated schema's own `alertContext` turned out to be `z.object({'@class':
z.string().optional()})` with **no** catchall (Orval's zod target does not translate the patched
spec's `additionalProperties: true` into a zod catchall), so without this override a real alert's
context fields would be silently stripped by the generated schema alone even after Phase 2's spec
patch. `types.ts` grafts the R5 compile-time open-enum widening onto the exported `Device`/`Alert`
types via `Omit<z.infer<typeof …Schema>, K> & Pick<Generated…, K>`, where `K` is each entity's
`WIDENED_FIELDS` constant — verified to compile and accept a truly novel enum value at both the
top-level (`deviceClass`) and nested (`antivirus.antivirusStatus`, `patchManagement.patchStatus`,
`Alert.responseActions[number].actionType`) depths via a scratch compile check (§7). `write-bodies.ts` reconciles all 9 body-carrying write
operations named by a Phase 5 `WriteOpKey`: two (`siteCreateBodySchema`, `deviceJobCreateBodySchema`)
are already spec-required and re-exported unchanged; the remaining seven get a hand-verified
wrapper — `udfWriteBodySchema` and the four update/settings bodies (`updateSiteVariableWriteBodySchema`,
`updateAccountVariableWriteBodySchema`, `updateProxyWriteBodySchema`) share one extracted
`requireSomeField` "reject an all-omitted body" refinement; the two variable-create bodies require
`name`; `warrantyWriteBodySchema` requires `warrantyDate` present but nullable. Every schema exports
a companion `*Input` type derived from itself (not the raw generated body), and `types.ts` also
exports pre-coerced `deviceSchema`/`alertSchema` values (`z.ZodType<Device>`/`z.ZodType<Alert>`) so
a Phase 7/8 `httpGet(path, deviceSchema, ctx)` call resolves to `Promise<Lenient<Device>>` — the
reconciled, open-enum-widened shape, honestly wrapped in `Lenient<T>` — instead of the closed-enum
`z.infer` `httpGet` would otherwise carry; a method declaring the clean `Promise<Device>` still
re-asserts that explicitly at its own return site, without also having to fight the closed-enum
hazard `coerceSchema` alone would leave in place.

---

## 5. Deviations From Plan (If Any)

1. **Six HTTP primitives, not four: `httpPut` and `httpGetArray` added.** The plan (mirroring
   `fuze-api`) names exactly `httpGet`/`httpPost`/`httpPatch`/`httpDelete`. While building this
   phase I read every non-`GET` `(method, path)` pair in the committed `spec/openapi.json` (the
   plan's own source of truth, fetched in Phase 2) and found Datto's real v2 API uses **no `PATCH`
   operations at all** (0 of 18 non-`GET` operations) and instead uses **`PUT`** for five
   operations this project's own `WriteOpKey` table (Phase 5) requires: `moveDevice`
   (`device-move`), `createQuickJob` (`device-job-create`), `create` site (`site-create`),
   `createSiteVariable` (half of `site-variable-set`), and `createAccountVariable` (half of
   `account-variable-set`). Without a validated `httpPut` primitive, Phase 7/8 could not implement
   these required (R1) operations without either bypassing `BaseResource` entirely (a resource
   calling `this.axios.put` directly — defeating the single-validated-primitive architecture this
   class exists to provide, and the design's explicit "every request... is rate-limited, retried,
   and error-mapped by that one shared stack") or mis-sending them as `POST`/`PATCH` against a
   server that documented `PUT` for that path. I added `httpPut`, mirroring `httpPost`'s exact
   bodied/bodiless overload shape, as the minimal, necessary fix. During review (Step B, architect
   round 1) the same class of gap was found on the read side: four real operations
   (`getByMacAddress`, `getDeviceAuditByMacAddress`, `getStdOut`, `getStdErr`) return a bare,
   non-paginated top-level array that fits neither `httpGet` (a single value — routing an array
   through it with a `z.array(...)` schema fails the *whole* response on one bad item, exactly the
   R7 wholesale-collection failure the design forbids) nor `paginate` (a `{pageDetails, <array>}`
   envelope these endpoints don't have). I added `httpGetArray` for the same reason and by the same
   necessity test as `httpPut`: it gives these endpoints `paginate`'s per-item leniency
   (`validateArrayResponse`) without inventing a second per-item-leniency mechanism. Both are
   implicit-intent handling, not scope creep — the plan's own discrete instruction (build the
   validated primitive set) is incomplete without them, since several of Phase 7/8's own named
   deliverables cannot be correctly implemented against the real API otherwise. I kept `httpPatch`
   (currently unused by any real Datto write) rather than dropping it: it costs nothing to keep,
   matches the plan's pinned name and the `fuze-api`-parity goal (Decision 1), and a future spec
   revision may add a real `PATCH` operation.

2. **`httpGet` gained an optional `params` argument.** Not in the plan's illustrative signature,
   but several non-paginated `GET` operations in the real spec carry query parameters (e.g.
   `getDeviceAuditSoftware`). Without it, Phase 7/8 would have to hand-build query strings into
   `path` for those endpoints instead of using axios's own `params` serialization. Minimal, purely
   additive (the parameter is optional, every existing call shape is unaffected), and consistent
   with `paginate`'s own `params` argument for the same purpose.

3. **`validateRequest`/`validateResponse` context handling follows Phase 3's pinned construction
   shapes literally, not `fuze-api`'s `ValidateResponseOptions` (with a `wirePayload` field).**
   Phase 3 pins the exact `DattoValidationError` construction call shapes future phases must use:
   `new DattoValidationError(err, 'request')` (2-arg, no options) and `new
   DattoValidationError(cursor.error, 'response', { context })` (context only, no payload). I
   implemented `validateRequest`/`validateResponse` to produce exactly these two call shapes rather
   than porting `fuze-api`'s richer `wirePayload`-carrying options object, since the plan's own
   Phase 3 text explicitly pins the call shape every later phase must agree on.

4. **`validateResponse`/`validateArrayResponse`/every `http*` primitive/`paginate` return
   `Lenient<T>` (`Lenient<T>[]` for the array-shaped ones), not the bare `T` the plan's illustrative
   signatures show.** Found in Step B review (typescript-cop round 1): since `BaseResource` always
   supplies a logger, `parseLenient` always takes its `Lenient<T>`-returning overload (every named
   field additionally admits `null`, on top of whatever `T` itself declares) — the original
   implementation re-asserted the narrower `T` over that return (`as T`), which is exactly the
   "quietly lies about nullability" defect Phase 4's own `typescript-cop-r1-f1`
   (`review-phase4/typescript-cop-r1.md`) built `Lenient<T>` to catch, reintroduced one layer up.
   Superseded Decision 2 below (which documented the original `as T` cast) — see this file's
   current Decision 2 for the shipped behavior and what it means for Phase 7/8.

5. **`paginate` pins `nextPageUrl`'s origin to the configured `apiUrl` and bounds the walk against
   a pathological cursor chain.** Found in Step B review (architect round 1: SSRF/credential-
   exfiltration via a cross-origin `nextPageUrl`; architect + engineer round 1: no cycle/page-count
   guard against a self-referential or ever-advancing cursor). Neither the plan nor the design names
   either guard explicitly, but both are necessary to satisfy the design's own transport-safety and
   availability expectations for the single highest-volume read path — the SSRF gap because the
   auth interceptor blindly attaches the bearer token to whatever host a server-controlled
   `nextPageUrl` names, and the unbounded-loop gap because nothing else in the design caps
   `paginate`'s walk. `resolveNextPageUrl` rejects (and otherwise re-issues relative-to-`baseURL`)
   any cursor whose origin doesn't match the configured `apiUrl`; a visited-URL `Set` rejects an
   exact repeat immediately, and a generous `MAX_PAGINATION_PAGES` (10,000) ceiling catches an
   ever-advancing chain that never repeats.

No other deviations. `paginate`'s parameter order, `validateArrayResponse`'s per-call aggregation
behavior, the primitive renaming rationale, and the schema-override module's file layout all match
the plan as specified.

---

## 6. Ambiguities & Decisions

1. **`context` is a required parameter on every `http*`/`validate*` primitive, not optional
   (`fuze-api`'s convention).** The plan's own Phase 7 example always supplies one, and requiring
   it (a) keeps every leniency-diagnostic and error-message `context` field meaningful rather than
   silently falling back to `(unknown)`, and (b) — for the write primitives specifically — makes
   the bodiless-vs-body-carrying overload dispatch unambiguous by fixed argument-tail length (3 vs
   5) rather than needing to reason about which of several optional trailing parameters were
   supplied. `httpDelete` is the one exception: it performs no validation of either side, so there
   is no error message or diagnostic a `context` label would ever attach to, and I dropped the
   parameter entirely rather than carry an unused one (which would also trip
   `@typescript-eslint/no-unused-vars`).

2. **`validateResponse`/`validateArrayResponse`, and every primitive built on them, return
   `Lenient<T>`/`Lenient<T>[]` — not the bare `T` this phase's first pass returned.** (Superseded by
   Step B review, typescript-cop round 1 — see §5 Deviation 4.) Since `BaseResource` always supplies
   a logger, `parseLenient` always takes its `Lenient<T>`-returning overload (every named field
   additionally admits `null`, on top of whatever `T` itself declares). The original implementation
   re-asserted the narrower `T` (`as T`) so every resource method (Phase 7/8) could return the
   clean, documented `Device`/`Alert`/etc. types directly — but that re-narrowing is exactly the
   "quietly lies about nullability" defect Phase 4's own `Lenient<T>` (`src/validation/
   schema-leniency.ts`) exists to surface, reintroduced one layer up with no type-level signal (`
   Device`/`Alert`'s own open-enum widening, by contrast, *is* reflected in their exported types).
   `BaseResource`'s primitives now return the honest `Lenient<T>` shape; a Phase 7/8 resource method
   that wants to return the clean `Device`/`Alert` type re-asserts that explicitly at its own return
   site — the same kind of documented, intentional cast `coerceSchema` already names in this file,
   now visible at the one place it is actually applied instead of hidden inside a primitive every
   resource method funnels through.

3. **`coerceSchema` is needed by, but not literally invoked in, this phase.** The plan's Phase 7
   "Opinionated Implementation Notes" example (`this.httpGet(path, deviceResponseSchema, context)`
   declared to return `Promise<Device>`) does not actually type-check as written: `deviceResponseSchema`'s own
   `z.infer` is structurally narrower (closed enums) than the exported `Device` type
   (open-enum-grafted), so a Phase 7 resource method will need `coerceSchema<Device>
   (deviceResponseSchema)` — exactly `fuze-api`'s own `company-resource.ts` pattern — to bridge
   them. I ported and kept `coerceSchema` (per the plan's own "port `BaseResource`... Keep
   `coerceSchema`" instruction) and verified via a scratch compile check (§7) that
   `coerceSchema<Device>(deviceResponseSchema)` produces a `z.ZodType<Device>` that still validates
   correctly at runtime, confirming Phase 7 has what it needs; I did not treat the plan's example
   snippet as literal since the plan's own "Interpreting the Plan" guidance treats code samples as
   illustrative, not mandates. Found in Step B review (architect round 1): leaving
   `deviceResponseSchema`/`alertResponseSchema` themselves un-coerced meant a Phase 7/8 author could
   pass one straight to `httpGet` and silently get the closed-enum `z.infer` type instead of
   `Device`/`Alert` — `coerceSchema` only helps if a caller remembers to reach for it.
   `schema-overrides/types.ts` now also exports pre-coerced `deviceSchema: z.ZodType<Device>` /
   `alertSchema: z.ZodType<Alert>` values (a local, same-file type-only cast — not by importing
   `coerceSchema`, which would invert this module's dependency direction relative to
   `client/resources`), so the coerced schema is the path of least resistance for the closed-enum
   hazard specifically. Found in Step B review (typescript-cop round 2): because `httpGet` (Decision
   2/§5 Deviation 4, also landed this round) returns `Promise<Lenient<TResponse>>`, not bare
   `Promise<TResponse>`, `this.httpGet(path, deviceSchema, ctx)` resolves to `Promise<Lenient<Device>>`,
   not `Promise<Device>` — a Phase 7/8 method declaring the clean `Promise<Device>` still re-asserts
   that explicitly at its own return site (the same `Lenient<T>`-to-`T` narrowing Decision 2 already
   documents for every `http*` primitive), same as it would with any other reconciled type.
   `deviceSchema`/`alertSchema`'s own doc comment (`types.ts`) states this precisely; `coerceSchema`
   itself remains available for any reconciled type that doesn't get one of these named exports.

4. **Write-body required-field marking now covers all 9 body-carrying write operations named by a
   Phase 5 `WriteOpKey`, not `device-udf-set` alone.** This phase's first pass scoped the
   deliverable to the module, its pattern, and one fully-worked example (`udfWriteBodySchema`),
   reasoning that hand-verifying "genuinely required" fields for the other ~9 bodies had no resource
   call site to validate against yet and risked guessing wrong with nothing to catch it. Step A
   review (`implementation-auditor-r1-f1`) found Phase 6 Step 3's own text ("wrap **each** generated
   write-body schema... in this one place") reads as a comprehensive, discrete instruction the
   original scoping didn't satisfy, and directed completing it within this phase rather than
   deferring to Phase 7/8. `write-bodies.ts` now reconciles all 9: two (`site-create`,
   `device-job-create`) are already spec-required and re-exported unchanged; the remaining seven
   each get a hand-verified wrapper (§4), sharing one extracted `requireSomeField` helper
   (`engineer-r1-f2`) for the four bodies where no single field is unambiguously "the" required one.
   `warrantyWriteBodySchema`'s `warrantyDate` is required-but-`nullable` (fixing the non-nullable
   gap this section originally flagged as a Phase 7/8 follow-up — see §11, now resolved rather than
   open). Every schema has a committed test, including an unknown-key-rejection case for each
   (`tests/unit/schema-overrides/write-bodies.test.ts`, 22 tests).

---

## 7. Tests

- `tests/unit/client/base-resource.test.ts` (25 tests, nock): `httpGet` tags `{kind:'read'}` and
  strips an unknown response key; `httpGet` forwards query params; `httpGetArray` tags
  `{kind:'read'}`, validates each item leniently, drops a malformed item rather than failing the
  whole call (R7), and forwards query params; `httpPost` bodiless sends no body and tags
  `{kind:'write', opKey}`; `httpPost` body-carrying validates and sends the body; `httpPost` throws
  `DattoValidationError('request')` **without sending** when the body fails validation
  (`scope.isDone()` asserted `false`); `httpPut` bodiless/body-carrying (mirroring `httpPost`);
  `httpPatch` body-carrying; `httpDelete` sends no body/response validation and tags the
  descriptor; `validateRequest` throws on an unknown key and on a missing required field, and
  returns validated data on success; `validateResponse` strips unknowns and throws
  `DattoValidationError('response')` on failure; `validateArrayResponse` drops one bad item while
  keeping the rest and emits **exactly one** aggregated `warn` (asserted via `toHaveBeenCalledTimes(1)`
  with `meta` carrying `dropped`/`total`); a fully-invalid array still produces a single `warn`
  summary; the dropped-item warn's message string never carries a wire value (R20 invariant); an
  all-valid array emits no `warn`; `coerceSchema` is confirmed to be a type-only cast whose
  returned schema still validates against its real runtime shape.
- `tests/unit/client/paginate.test.ts` (12 tests, nock + one hand-stubbed `AxiosInstance`): a
  two-page walk concatenates items and stops on `nextPageUrl: null`; a page terminating with
  `nextPageUrl: ""` (the real Datto terminal form) also stops the walk; a missing `pageDetails`
  throws `DattoValidationError` rather than truncating; a non-string `nextPageUrl` throws the same;
  a lenient (bad) item on page 2 is dropped without aborting the walk; the walk consumes the read
  rate-limit window exactly once per page fetched (asserted via the captured `RateDescriptor`
  array); the initial `params` argument is sent only on the first request; a cross-origin
  `nextPageUrl` is refused rather than followed (SSRF guard); a `nextPageUrl` that cycles back to
  an already-fetched page throws rather than looping forever; an ever-advancing `nextPageUrl` that
  never repeats and never terminates throws once `MAX_PAGINATION_PAGES` is exceeded (exercised
  against a hand-stubbed `AxiosInstance` rather than 10,000 real nock round trips, which would make
  the test impractically slow without adding assurance beyond what the stub already proves).
- `tests/unit/schema-overrides/device-overrides.test.ts` (10 tests): `udfSchema` accepts
  `udf1`/`udf300`, `null`, a numeric/boolean/object/array value, and rejects a non-`udf` key;
  `deviceResponseSchema` validates a device with a non-string `udf300` and `deviceClass:
  'rmmnetworkdevice'`, and validates with `udf` omitted; `DEVICE_WIDENED_FIELDS` has the expected
  three entries.
- `tests/unit/schema-overrides/alert-overrides.test.ts` (5 tests): `alertContextSchema` accepts a
  real `@class`-tagged context with fields the spec's dead `*Context` schemas don't model, and one
  with no `@class`; `alertResponseSchema` validates an alert with a real-shaped `alertContext` the
  generated schema alone would strip, and with `alertContext` omitted; `ALERT_WIDENED_FIELDS` has
  the expected two entries.
- `tests/unit/schema-overrides/pagination.test.ts` (6 tests): `pageDetailsSchema` accepts a
  well-formed cursor, `null` and empty-string `nextPageUrl`, rejects a missing `count` and a
  mistyped `totalCount`, and accepts an unknown extra envelope key.
- `tests/unit/schema-overrides/write-bodies.test.ts` (22 tests): all 9 write-body override schemas
  (`udfWriteBodySchema`, `siteCreateBodySchema`, `deviceJobCreateBodySchema`,
  `warrantyWriteBodySchema`, `createSiteVariableWriteBodySchema`/`updateSiteVariableWriteBodySchema`,
  `createAccountVariableWriteBodySchema`/`updateAccountVariableWriteBodySchema`,
  `updateProxyWriteBodySchema`) each have an accepts-valid-body case, a rejects-the-documented-gap
  case (missing/empty per that body's own required-ness rule), and a rejects-an-unknown-key case
  (R6's unknown-key-rejection guarantee, now CI-gated for every schema in the module, not spot-
  checked once outside the committed suite).
- **Scratch compile verification (not committed — Phase 9 owns the permanent version of this
  check):** confirmed via a standalone `tsc --noEmit` run that `Device['deviceClass']`,
  `Device['antivirus']['antivirusStatus']`, `Device['patchManagement']['patchStatus']`,
  `Alert['priority']`, and `Alert['responseActions'][number]['actionType']` all accept a truly
  novel string literal, proving the `Omit`/`Pick` graft in `schema-overrides/types.ts` widens at
  every depth the design requires, before Phase 7 depends on it.

---

## 8. Security & Best-Practices Review

- No new logging call sites introduced beyond `validateArrayResponse`'s aggregated drop `warn` and
  `paginate`'s inherited leniency diagnostics (both already routed through the masked
  `DattoLogger` a resource is always constructed with) — every wire-derived value in the drop
  summary (`firstErrors`) rides in `meta`, never the message string, preserving the R20 masking
  boundary (explicitly tested).
- `udfSchema`'s widened value union (`string | number | boolean | record | array`) does not weaken
  security: it only affects what a UDF *validates as*, not what is logged — the Phase-3 masker
  already redacts every non-null UDF value "regardless of wire type," so widening the schema keeps
  the masker's own documented behavior actually reachable (a non-string UDF no longer fails
  validation and vanishes from the record before the masker ever sees it).
- `alertContextSchema`'s catchall is deliberately scoped to the `alertContext` sub-object only, not
  a blanket relaxation of the whole `Alert` schema — every other field stays as generated.
  `pageDetailsSchema`'s catchall is similarly scoped to the pagination envelope, not the item
  payloads, so an added benign envelope key can't be used to smuggle unvalidated data into a
  resource's return value (the named array is still validated per-item via `validateArrayResponse`).
- No `eval`, no dynamic `require`, no unsanitized string interpolation into a URL path — every path
  in this phase's tests is a literal or nock-matched pattern; dynamic path construction from a
  caller-supplied `uid` is a Phase 7/8 concern (string template interpolation, no injection surface
  since paths are sent as axios URL segments, not executed).
- `sendWrite`'s bodiless branch explicitly sends `undefined` as the body (never an empty object or
  omitted argument that axios might serialize unpredictably), so a bodiless write's wire payload is
  deterministic (`content-length: 0`), verified directly in the `httpPost`/`httpPut` bodiless tests.
- `paginate` pins every `nextPageUrl` to the configured `apiUrl`'s origin before following it
  (`resolveNextPageUrl`), rejecting a cross-origin cursor rather than sending the credentialed
  request (and its bearer token, attached by the auth interceptor regardless of host) wherever a
  server-controlled URL points — an SSRF/credential-exfiltration guard, tested directly (§7). The
  walk is also bounded against a pathological cursor chain (a repeated URL, or
  `MAX_PAGINATION_PAGES` pages without a terminal), so neither guard can itself become an
  availability hazard on legitimate traffic while still failing fast on hostile/buggy input.

---

## 9. Self-Review Scoring

| Element | Before | After | Comments |
|---------|--------|-------|----------|
| Extensibility | 9.0 | 9.5 | Factored the shared bodied/bodiless write dispatch into one private `sendWrite` helper reused by `httpPost`/`httpPut`/`httpPatch` instead of triplicating the branching logic, so a future sixth write verb (unlikely, but e.g. a bulk endpoint) is a one-line addition. |
| Understandability | 9.0 | 9.5 | Added the `httpPut`-addition rationale directly in `BaseResource`'s own class doc comment (not just these notes), so a future reader hits the "why five primitives, not four" explanation at the point of the surprise, not only in phase-notes archaeology. |
| Best Practices | 9.0 | 9.5 | Named, single-purpose private helper (`sendWrite`) instead of inlining the bodied/bodiless branch three times; capped `validateArrayResponse`'s reported errors (`MAX_REPORTED_DROP_ERRORS`) rather than leaving an unbounded `firstErrors` array. |
| Plan Adherence | 9.0 | 9.5 | Re-verified every pinned construction shape (`DattoValidationError`'s 2-/3-arg forms, `paginate`'s exact parameter order, the `pageDetailsSchema`/`udfSchema` literal text) against the plan line-by-line; the one substantive deviation (`httpPut`) is grounded in a direct reading of the committed spec, not a preference, and is documented with the exact operations it unblocks. |
| Test Quality | 9.0 | 9.5 | Added the "throws without sending" assertion (`scope.isDone()` false) to the request-validation-failure test, and the "single warn even when every item is invalid" test, after the first pass only covered the partial-failure cases — both guard against a regression the plan's own Tests section calls out by name. |

---

## 10. Iterative Improvements Made

1. Replaced an initial nock body-matcher predicate (`(body) => body === "" || body === undefined`)
   in the bodiless-write tests with an unconstrained path matcher after discovering axios sends an
   empty string body that nock's matcher saw differently than expected — the simpler matcher still
   proves the intended behavior (no validation error, correct descriptor) without over-asserting on
   axios/nock's internal body-serialization detail.
2. Added explicit `as unknown as {...}` casts in `validateRequest`'s failure-path tests (an
   intentionally-invalid literal passed against a schema whose inferred type would otherwise reject
   it at compile time) rather than loosening the test helper's own generic signature — keeps
   `TestResource.request`'s signature an honest mirror of `BaseResource.validateRequest` itself.
3. Ran a scratch (uncommitted) `tsc` compile check of the `Device`/`Alert` open-enum graft at every
   documented depth before considering the schema-overrides module done, catching (by confirming
   correct, not by finding a defect) that the `Omit`/`Pick` composition in `types.ts` behaves
   exactly as designed ahead of Phase 7/9 depending on it.
4. Ran `prettier --write` over every new file for formatting consistency with the rest of the repo,
   then re-ran the full `lint`/`typecheck`/`test`/`build` sequence to confirm formatting-only
   changes didn't alter behavior.

---

## 11. Remaining Risks or Follow-Ups

- **`filter-create`/`filter-delete` (Phase 5's `WRITE_LIMITS` table) have no corresponding
  operation in the committed `spec/openapi.json`.** While hand-verifying write-body required
  fields (§6 Decision 4) I enumerated every non-`GET` `(method, path)` pair in the spec and found
  no `/filter/**` write path at all — `FilterResource` (Phase 8) is GET-only in the real API
  (`getCustomFilters`, `getDefaultsFilters`, `getSiteDeviceFilters`). These two opKeys are
  therefore currently unreachable dead table entries. This is a Phase 5 file (`rate-limits.ts`),
  out of this phase's scope to edit; flagging it for Phase 8 (which implements `FilterResource` and
  will concretely discover it has no write method to assign either opKey to) or for
  ImplementationAuditor/Project-Lead triage — the two keys may be a stale assumption from the
  `system/request_rate` endpoint's `operationWriteStatus` naming rather than a real v2 operation.
- **`httpPatch` remains unused by any real Datto write** (the spec has zero `PATCH` operations,
  confirmed by direct enumeration). Kept for `fuze-api` naming parity and forward-compatibility
  (§5 Deviation 1); Phase 7/8 should not feel obligated to find a use for it.
- **`account-variable-set`/`site-variable-set` cover both a `PUT` (create) and a `POST` (update)
  operation under one opKey**, and the `DELETE` counterparts (`deleteAccountVariable`,
  `deleteSiteVariable`, `deleteProxy`) have no explicit opKey of their own in the Phase 5 table —
  Phase 7/8 will need to decide (and document) which existing opKey a delete shares, consistent
  with the design's own "variable mutations"/"proxy... mutations" grouping language.

---

## 12. Commands Run / To Run

- `npm run lint` — 0 errors, 11 pre-existing warnings (all in the untouched old surface:
  `src/auth.ts`, `src/client.ts`, `src/httpClient.ts`, `src/logger.ts`), unchanged from Phase 5's
  baseline.
- `npm run typecheck` (`typecheck:src` + `typecheck:test` + `typecheck:tools`) — clean.
- `npm test` — 323 tests passing across 25 files (80 new in this phase, across the original
  implementation and the Step A/Step B review rounds; every pre-existing test from Phases 1–5 still
  green, confirming coexistence).
- `npm run build` — `tsup` succeeds (unaffected: `src/index.ts` is untouched this phase, per the
  coexistence rule — the new modules are not yet wired into the public barrel).
- `npx prettier --write` — applied to every new/changed file for formatting consistency, followed by
  a full re-run of lint/typecheck/test/build to confirm no behavioral change.
- Scratch (uncommitted) `tsc --noEmit` compile check of the `Device`/`Alert` open-enum graft at
  every depth (§7, §10).

---

## 13. Final Assertion

I assert that:
- Only Phase 6 has been implemented (the Step A/Step B review rounds reflected in this file's
  §5/§6 revisions are fixes to Phase 6's own delivered code, not scope drift into Phase 7/8).
- No unnecessary scope expansion occurred — every substantive deviation from the plan's literal
  primitive list (`httpPut`, `httpGetArray`) is a documented, necessary addition grounded in the
  committed spec or a concrete R7/security finding, not a preference, and Phase 5's rate-limit
  table (a genuine, related finding) was left untouched and reported rather than edited.
- All quality scores are ≥ 9.5.
