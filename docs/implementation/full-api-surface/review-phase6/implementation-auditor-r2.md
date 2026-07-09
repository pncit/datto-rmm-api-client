## implementation-auditor — round 2

Scope: re-verification of the four Open findings from round 1 against the reviser's `reviser-r1.md`
dispositions and the current working tree, plus a fresh hunt over the round-2 diff. The round-2
changes are confined to `src/schema-overrides/write-bodies.ts` (+ its barrel and tests),
`src/client/resources/base-resource.ts` (the `paginate` optional-args restore and the non-array
`warn` branch), and the two client test files — no old-surface file was touched, so the coexistence
rule still holds.

### Re-verification of round-1 findings

- **r1-f1 (Medium, PlanAdherence — "each write body")** → **Fixed/ratified.** `write-bodies.ts` now
  reconciles **every** body-carrying write op named by a Phase 5 `WriteOpKey`: `site-create`
  (`siteCreateBodySchema`) and `device-job-create` (`deviceJobCreateBodySchema`) are re-exported
  unchanged (their `required` fields — `CreateSiteRequest.required:["name"]`,
  `CreateQuickJobRequest.required:["jobComponent","jobName"]` — are already emitted non-optional,
  confirmed against the generated zod); the remaining bodies get hand-verified wrappers
  (`warrantyWriteBodySchema`, the two variable-create `name`-required bodies, the two variable-update
  and one proxy "reject-empty" bodies). Each has a test. This satisfies the plan's literal "wrap each
  generated write-body schema … in this one place (R6)" and is plan-adherent, not scope creep (Step 3
  mandates it). The reviser also correctly left the sibling Phase 5 gaps (`POST /site/{siteUid}` with
  no `WriteOpKey`; `filter-create`/`filter-delete` dead keys) untouched and documented rather than
  editing an out-of-scope file — see Drift Report.

- **r1-f2 (Low, Tests — R20 meta invariant)** → **Fixed/ratified.** The rewritten test
  (`base-resource.test.ts:442-459`) parses `{ udf1: "S3CR3T-RAW-WIRE-VALUE" }` (a real string) against
  `z.object({ udf1: z.number() })`, so the raw value genuinely reaches `dropped[].error`, and asserts
  it is absent from **both** the message string and `JSON.stringify(meta)` — the actual `firstErrors`
  leak path, not a `.length` number that never entered the data. This is now a real regression guard.

- **r1-f3 (Low, PlanAdherence — paginate optional args)** → **Fixed/ratified.**
  `base-resource.ts:375-381` restores `params?: Record<string, unknown>, context?: string`, exactly
  the plan's pinned `paginate(startPath, arrayKey, itemSchema, params?, context?)`; the omitted-context
  path falls back to `UNKNOWN_CONTEXT`. A new test ("accepts omitted trailing params/context") calls
  with only the first three arguments.

- **r1-f4 (Low, Design — silent zero-item page)** → **Fixed/ratified.** `validateArrayResponse`
  (`base-resource.ts:307-331`) now branches on `Array.isArray(data)`: a genuinely-empty array emits
  nothing, but non-array/`undefined`/`null` emits a distinct `warn` (`"response array field was not an
  array"`, `meta:{context,receivedType}`). Since `paginate` passes `data?.[arrayKey]`, a wrong/missing
  `arrayKey` now surfaces. Covered by three `base-resource` tests and one `paginate` test.

### Drift Report
**Out-of-scope changes:** None. All round-2 edits are to Phase 6-owned files.
**Cross-phase gaps (properly deferred, not raised as gating findings — not fixable within Phase 6):**
The reviser discovered `POST /api/v2/site/{siteUid}` (site update, body `SiteRequest`/generated
`updateBody`) is a body-carrying write with **no** `WriteOpKey` in Phase 5's `rate-limits.ts`, so no
`BaseResource` write primitive can dispatch it until that table gains a key — an R1 coverage risk for
Phase 7/8. This is documented in `write-bodies.ts`'s module doc and belongs to Phase 5/8 triage
(editing `rate-limits.ts` is out of Phase 6 scope per the coexistence rule); consistent with how the
sibling `filter-create`/`filter-delete` dead-key discrepancy was tracked in round 1. Flagged here so
Phase 8's `coverage-map.test.ts` (the authoritative R1 guard) does not silently omit it.

## Findings

| ID | Severity | Status | Category | Location | Finding | Recommendation |
|----|----------|--------|----------|----------|---------|----------------|
| implementation-auditor-r1-f1 | Medium | Closed | PlanAdherence | `src/schema-overrides/write-bodies.ts` | ratified: every body-carrying write op named by a Phase 5 `WriteOpKey` is now reconciled (2 re-exported as already spec-required, 7 hand-verified wrappers), each with a test; satisfies the plan's "wrap each generated write-body schema" (Step 3, R6). | — |
| implementation-auditor-r1-f2 | Low | Closed | Tests | `tests/unit/client/base-resource.test.ts:442-459` | ratified: the R20-invariant test now flows a real string wire value into `dropped[].error` and asserts its absence from both the message and `JSON.stringify(meta)` — a genuine leak guard, replacing the prior `.length`-number no-op. | — |
| implementation-auditor-r1-f3 | Low | Closed | PlanAdherence | `src/client/resources/base-resource.ts:375-381` | ratified: `paginate`'s trailing `params?`/`context?` restored to optional, matching the plan's pinned signature; `UNKNOWN_CONTEXT` fallback preserves diagnostics; new test proves the 3-arg call compiles and walks. | — |
| implementation-auditor-r1-f4 | Low | Closed | Design | `src/client/resources/base-resource.ts:307-331` | ratified: non-array `data` now emits a distinct `warn` instead of a silent `[]`, so a wrong/missing `arrayKey` surfaces; empty-array still silent; covered by 4 new tests. | — |
| implementation-auditor-r2-f1 | Low | Open | BestPractices | `src/schema-overrides/write-bodies.ts:96-98` | `warrantyWriteBodySchema` is hand-rebuilt as a fresh `z.strictObject({ warrantyDate: z.string().nullable() })` instead of being derived from the generated `setWarrantyDataBody` — unlike every sibling in this file, which imports and wraps (`.refine`/`.extend`) its generated schema. The generated warranty schema is never imported, so a regeneration that renames it produces no compile error here, and a regeneration that adds a field to the warranty body would be silently strict-rejected rather than tracked — exactly the regeneration-drift the module's own doc says these wrappers exist to survive. Functionally correct today (the generated body carries only `warrantyDate`), but it breaks the module's single-source-of-truth pattern. | Derive from the generated schema to stay consistent and regeneration-tracking: `export const warrantyWriteBodySchema = setWarrantyDataBody.extend({ warrantyDate: z.string().nullable() })` (import `setWarrantyDataBody` from `-v2-device.zod`; `.extend` overrides the existing optional field with the required-nullable one and preserves any future fields). |
