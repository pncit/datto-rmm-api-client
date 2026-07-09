## project-lead — round 1

Scope: Phase 6 — `BaseResource` (validated HTTP primitives, strict `paginate`) and the
`src/schema-overrides/` module. Reviewed the current working tree (post `reviser-r2.md`, i.e. the
`.extend()`-derived `warrantyWriteBodySchema` fix is in place but uncommitted) against
`plan.md`'s Phase 6 section, `design.md`'s R-table, and `implementation-phase6-notes.md`. This is
my first turn on this phase; `implementation-auditor` has already run three rounds and closed five
findings (r1-f1..f4, r2-f1) — I re-checked their disposition against the diff rather than re-raising
them, and looked past their line-by-line plan-adherence lens toward delivery/requirements framing,
scope, and rollout risk.

### Requirements Coverage (R3, R6, R8 — this phase's declared set)

| R-ID | Requirement (summary) | Status | Notes |
|------|------------------------|--------|-------|
| R3 | Paginated collections walk `pageDetails.nextPageUrl` fully; cursor validated strictly (throws on missing/malformed), `null`/terminal handled, item leniency separate from cursor strictness | Fully met | `paginate` throws `DattoValidationError('response')` on a missing/malformed cursor (tested), terminates on `null` and on the real `""` terminal form (tested), and validates each page's array via the same per-item leniency as any other response (tested). Read `RateDescriptor` attached per page (tested). |
| R6 | Request bodies validated strictly; unknown keys rejected; required-field enforcement added by hand for the write set since the spec under-declares `required` | Fully met, with a test-quality gap | All 9 body-carrying write ops named by a `WriteOpKey` now have a reconciled schema in `write-bodies.ts` (expanded from the original single `device-udf-set` example across `reviser-r1`/`reviser-r2`, per plan Step 3's literal "wrap **each** generated write-body schema … in this one place"). The core R6 guarantee (unknown key → reject) is committed-test-covered for only 1 of the 9 schemas — see finding f2. |
| R8 | Known spec defects corrected deterministically, in this phase's scope: full `udf1…udf300` record (non-string-tolerant), permissive `@class`-tagged `alertContext` | Fully met | `udfSchema`/`deviceResponseSchema` and `alertContextSchema`/`alertResponseSchema` match the plan's literal schema text and are tested against realistic wire shapes (non-string UDF, dead-`*Context`-shaped `alertContext` fields). |

### Behavior vs Intent / Scope / Risk

No behavior-vs-intent mismatches found beyond what's already fixed: `paginate`'s empty-string
terminal, the non-array-data diagnostic, and the optional trailing `paginate` args all match the
design's stated intent after `reviser-r1`'s fixes, and I independently re-derived the `httpPut`
justification and the DELETE-endpoint parameter shapes directly against `spec/openapi.json` (no
DELETE operation takes a query parameter, confirming `httpDelete`'s no-params design is sound; no
`PATCH` operation exists, confirming the plan's `httpPatch` primitive is legitimately unused-but-kept
per §5 Deviation 1). No scope creep: every changed/added file is new (`src/client/resources/
base-resource.ts`, `src/schema-overrides/**`, matching `tests/**`); the old runtime surface is
untouched. No new dependencies were introduced in this phase. Rollout risk is low — this is
internal infrastructure with no public surface change yet (Phase 7/8 own that), consistent with the
coexistence rule.

The two findings below are about the **quality of the delivery artifact itself** — the phase notes
that downstream phases and the process-historian treat as ground truth, and the test suite's
coverage of a core R6 guarantee across the write-body module's now-much-larger surface — not about
runtime correctness, which I found sound everywhere I checked it.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| project-lead-r1-f1 | Medium | Open | Documentation | `docs/implementation/full-api-surface/implementation-phase6-notes.md` (§3, §4, §6 Decision 4, §7, §11, §12) | The implementor's own phase notes were committed once (`012e613`) and never updated across the two `reviser` rounds that materially changed this phase's scope. They still state: (a) §6 Decision 4 / §11 — write-body required-field marking is "scoped to `device-udf-set` only," with the other ~9 bodies "deferred to Phase 7/8," and the `warrantyDate` nullable gap is an *open* follow-up for Phase 7/8 — all three claims are now false: `write-bodies.ts` reconciles all 9 body-carrying write ops (verified in the diff and by `implementation-auditor-r2`/`r3`), and the `warrantyDate` `.nullable()` fix was applied in `reviser-r1`. (b) §7 Tests — still says `write-bodies.test.ts` has "(3 tests)"; the committed file has 16. (c) §3 Files Touched — still describes `write-bodies.ts` as "the write-body required-field-mark pattern and its one worked example," omitting the other 8 schemas now in the file. (d) §12 — still reports "293 tests passing … 25 files"; the current suite (confirmed by `implementation-auditor-r3`) is 311/311. This file is the artifact `process-historian` synthesizes from and the one Phase 7/8's implementor is told to read for "what Phase 6 actually built" — as written it sends a reader looking for work that is already done and undercredits the delivered write-body coverage. | Update `implementation-phase6-notes.md` (§3, §4, §6 Decision 4, §7, §11, §12) to describe the actual shipped state: all 9 write-body schemas reconciled with 16 tests, 311 total tests, and remove/resolve the now-stale `warrantyDate` open-item framing (note it as already fixed, not as a Phase 7/8 to-do). |
| project-lead-r1-f2 | Medium | Open | Tests | `tests/unit/schema-overrides/write-bodies.test.ts` | R6 requires unknown keys to be strictly rejected on every validated request body. Of the 9 write-body override schemas now in `write-bodies.ts`, only `udfWriteBodySchema` has a committed test asserting unknown-key rejection; the other 8 (`siteCreateBodySchema`, `deviceJobCreateBodySchema`, `warrantyWriteBodySchema`, `createSiteVariableWriteBodySchema`, `createAccountVariableWriteBodySchema`, `updateSiteVariableWriteBodySchema`, `updateAccountVariableWriteBodySchema`, `updateProxyWriteBodySchema`) have only "accepts required field(s)" / "rejects empty body" tests — no "rejects unknown key" case. `implementation-auditor-r3` confirmed unknown-key rejection for three of these (`warrantyWriteBodySchema`, `createSiteVariableWriteBodySchema`, `createAccountVariableWriteBodySchema`) only via an **uncommitted, ad hoc `tsx` spot-check**, not a regression-gated test — and did not check the remaining five at all. This is exactly the class of regression `implementation-auditor-r2-f1` caught (a hand-rebuilt `warrantyWriteBodySchema` that silently dropped the derive-from-generated pattern); nothing in CI would catch a repeat of that mistake, or a future zod `.extend()`/`.refine()` semantics change, for any of these 8 schemas. | Add a "rejects an unknown key" test for each of the 8 schemas listed, mirroring the existing `udfWriteBodySchema` case, so R6's unknown-key-rejection guarantee is CI-gated for the whole write-body module, not spot-checked once outside the committed suite. |
