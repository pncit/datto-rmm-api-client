## implementation-auditor — round 1

Scope: Phase 6 — `BaseResource` (validated HTTP primitives + strict `paginate`) and the
`src/schema-overrides/` module. The working tree adds only new, untracked files
(`src/client/resources/base-resource.ts`, `src/schema-overrides/**`, and their `tests/**`
counterparts); no tracked source under the old runtime surface was touched, so the coexistence rule
holds. I verified the claimed `httpPut` deviation directly against the committed spec
(`spec/openapi.json`): it has **0** `PATCH` operations and exactly the **5** `PUT` operations the
notes name (`moveDevice`, `createQuickJob`, `createAccountVariable`, `create` site,
`createSiteVariable`) — the deviation is a genuine necessity for Phase 7/8's required (R1) writes,
not scope creep, and is well-documented in the class doc. I also confirmed the codemod-widening
(`(string & {})`) is present on the generated enum types the `Omit`/`Pick` graft in `types.ts`
depends on (`deviceDeviceClass.ts`, `antivirusAntivirusStatus.ts`, `patchManagementPatchStatus.ts`,
`alertPriority.ts`, `responseAction.actionType`), so the graft widens at every depth as designed.

### Phase Coverage Checklist
| Step | Status | Notes |
|------|--------|-------|
| `BaseResource` port; rename error to `DattoValidationError`; thread masked logger + single shared axios | ✅ Implemented | Constructor takes `(axios, logger)`; every primitive routes through the shared instance |
| Keep `coerceSchema` | ✅ Implemented | Ported verbatim; type-only cast, runtime unaffected |
| `validateRequest` (strict, throws) | ✅ Implemented | `safeParse` → `DattoValidationError(err, 'request')`, pinned 2-arg form |
| `validateResponse` (lenient via `parseLenient`, throws) | ✅ Implemented | Re-asserts `T` over `Lenient<T>`; documented narrowing |
| `validateArrayResponse` per-item drop, **one** aggregated `warn`, capped errors, R20 meta | ⚠️ Partial | Aggregation/cap correct; R20 meta-masking is not genuinely exercised and `firstErrors` sit outside the masker's key-based scrub (f2) |
| Rename primitives `httpGet`/`httpPost`/`httpPatch`/`httpDelete`; descriptor tagging | ✅ Implemented | Plus `httpPut` (verified-necessary deviation) and an additive `httpGet` `params` arg |
| `paginate` strict cursor, per-page read descriptor, null terminal | ⚠️ Partial | Behavior correct; trailing `params`/`context` made required vs. the pinned optional signature, undisclosed (f3) |
| `udfSchema` (non-string-tolerant record) | ✅ Implemented | Matches the plan's literal schema text |
| `alertContextSchema` (open `@class` object) | ✅ Implemented | `@class` made `.optional()` (safer; accepts contextless alerts) |
| `pageDetailsSchema` (strict fields, tolerant catchall) | ✅ Implemented | Matches the plan's literal schema text |
| Required-field marks for the write set | ⚠️ Partial | Only `device-udf-set`; other ~9 bodies deferred to Phase 7/8 (f1) |
| Reconciled entity types + `WIDENED_FIELDS` + `OVERRIDE_ENTITIES` registry | ✅ Implemented | `Omit`/`Pick` graft driven from `as const` constants; registry carries schema objects |
| Barrel `index.ts` | ✅ Implemented | Re-exports the reconciled forms |
| Tests (base-resource, paginate, schema-overrides) | ✅ Implemented | Cover the behaviors the plan's Tests section names; two quality gaps (f2, f4) |

### Drift Report
**Out-of-scope changes:** None. All changes are new files; no old-surface file was modified.
**Acceptable Phase 6 necessities:** `httpPut` (verified against the spec — required for `device-move`,
`device-job-create`, `site-create`, `site-variable-set`, `account-variable-set`); an additive optional
`params` arg on `httpGet` (real GETs carry query params); `httpPatch` retained per the plan's pinned
primitive name despite 0 real PATCH ops. None of these expand scope beyond building the primitive set.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| implementation-auditor-r1-f1 | Medium | Open | PlanAdherence | `src/schema-overrides/write-bodies.ts` | Plan Step 3 says "wrap **each** generated write-body schema marking the genuinely required fields… in this one place (R6)," but only `device-udf-set` is reconciled; the ~9 other body-carrying writes (`device-job-create`, `device-warranty-set`, `site-create`, `site-variable-set`, `account-variable-set`, `device-proxy-set`, …) are deferred to Phase 7/8. The deferral rationale (§6 Decision 4 — no call site yet, speculative marks risk guessing wrong) is reasonable and the plan's Tests section names only one write-body test, but this is a real narrowing of a discrete plan step that must be explicitly ratified rather than silently scoped down. | Either add the remaining required-field marks now (hand-verified against the endpoint docs), or record this as a deliberate deferral the orchestrator/human ratifies — and update the plan/notes so "each write body" is not left as an unmet literal. Note §11 already flags `setWarrantyDataBody.warrantyDate` needs `.nullable()`, reinforcing that these bodies need real per-body work. |
| implementation-auditor-r1-f2 | Low | Open | Tests | `tests/unit/client/base-resource.test.ts:442-458` | The "R20 invariant" test computes `"S3CR3T-SHAPE-MISMATCH".length` (a number, `21`) and parses `{ udf1: 21 }` — the secret string never enters the data, so `expect(message).not.toContain("S3CR3T")` proves nothing. It also only inspects the message string, never `meta`. Meanwhile `validateArrayResponse` puts `firstErrors` (prettified zod error strings) into `meta`, and the masker (`src/logging/mask.ts`) scrubs only `udf<N>`-keyed values — a wire value embedded inside a prettified error string under the `error` key would bypass masking entirely. In practice zod's `prettifyError` emits type names, not values, so no leak occurs today, but the invariant is asserted by a test that cannot catch a regression. | Rewrite the test to place a real string wire value into a field that fails validation, then assert (a) it is absent from the message string and (b) the value does not appear un-redacted anywhere in the `meta` passed to the masked sink. Confirm `firstErrors` cannot carry a raw wire value into unmasked `meta`. |
| implementation-auditor-r1-f3 | Low | Open | PlanAdherence | `src/client/resources/base-resource.ts:353-359` | The plan pins `paginate(startPath, arrayKey, itemSchema, params?, context?)` with the last two **optional**; the implementation makes `params: Record<string, unknown> \| undefined` and `context: string` **required**. Requiring them is defensible (forces an explicit diagnostic context, consistent with the `http*` primitives), but §5 claims "paginate's parameter order… match the plan as specified" and lists no deviation — this optionality change is undisclosed. | Either restore the optional trailing parameters to match the pinned signature, or add this to §5 Deviations with the same justification used for the required `context` on `http*` (Decision 1), so the change is an owned decision rather than a silent divergence from a pinned signature. |
| implementation-auditor-r1-f4 | Low | Open | Design | `src/client/resources/base-resource.ts:296-324` | When `data` is **not** an array, `validateArrayResponse` returns `[]` with no diagnostic. In `paginate`, if `data[arrayKey]` is absent/misnamed (wrong `arrayKey`, or a schema drift where the array field vanishes), the page silently yields zero items with no `warn` — exactly the silent-data-loss class the design condemns, and indistinguishable from a legitimately empty page. | Emit a `warn` (message-only static text, count in `meta`) when `data` is present-but-not-an-array, distinguishing it from the genuinely-empty-array case, so a wrong array key or a missing array field surfaces instead of vanishing. |
